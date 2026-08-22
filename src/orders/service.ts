import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { create } from "@bufbuild/protobuf";

import type { OrderEventProducer, OrderProcessed } from "../common/kafka.js";
import { writeJson } from "../common/status.js";
import {
  ProcessOrderItemRequestSchema,
  type ProcessOrderItemRequest,
  type ProcessOrderItemResponse
} from "../generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";

const maximumBodyBytes = 1_048_576;

export interface ProcessOrderRequest {
  readonly customer_id?: string;
  readonly items: readonly ProcessOrderRequestItem[];
}

export interface ProcessOrderRequestItem {
  readonly item_id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly unit_price?: number;
}

export interface ProcessOrderResponse {
  readonly order_id: string;
  readonly status: string;
  readonly total_amount: number;
  readonly processed_at: string;
  readonly confirmed_items?: readonly ProcessOrderResponseItem[];
}

export interface ProcessOrderResponseItem {
  readonly item_id: string;
  readonly sku: string;
  readonly available_qty: number;
  readonly reserved: boolean;
  readonly status: string;
  readonly error?: string;
}

interface ItemResult {
  readonly itemId: string;
  readonly sku: string;
  readonly requestedQty: number;
  readonly availableQty: number;
  readonly reserved: boolean;
  readonly status: string;
  readonly unitPrice: number;
  readonly error: string;
}

export interface InventoryClient {
  processOrderItem(
    request: ProcessOrderItemRequest,
    deadline: number,
    signal: AbortSignal
  ): Promise<ProcessOrderItemResponse>;
  close(): void;
}

export class OrderService {
  readonly #inventory: InventoryClient;
  readonly #timeoutMs: number;
  readonly #softMarginMs: number;
  readonly #publisher: OrderEventProducer | undefined;
  readonly #publishing = new Set<Promise<void>>();

  public constructor(
    inventory: InventoryClient,
    timeoutMs: number,
    softMarginMs: number,
    publisher?: OrderEventProducer
  ) {
    if (softMarginMs > timeoutMs)
      throw new Error(
        "ORDER_SERVICE_SOFT_DEADLINE_MARGIN must not exceed ORDER_SERVICE_REQUEST_TIMEOUT"
      );
    this.#inventory = inventory;
    this.#timeoutMs = timeoutMs;
    this.#softMarginMs = softMarginMs;
    this.#publisher = publisher;
  }

  public async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.method !== "POST" || request.url !== "/v1/processorder") return false;
    try {
      const input = decodeRequest(await readJson(request));
      const result = await this.process(input, header(request, "x-request-id"), request);
      writeJson(response, 200, result);
      this.publish(result);
    } catch (error: unknown) {
      if (error instanceof RequestError) {
        response.writeHead(error.status, { "content-type": "text/plain; charset=utf-8" });
        response.end(`${error.message}\n`);
      } else if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("internal server error\n");
      }
    }
    return true;
  }

  public async process(
    input: ProcessOrderRequest,
    requestId?: string,
    requestEvents?: NodeJS.EventEmitter
  ): Promise<ProcessOrderResponse> {
    const orderId = requestId === undefined || requestId.length === 0 ? randomUUID() : requestId;
    const controller = new AbortController();
    const requestAborted = (): void => {
      controller.abort(new Error("HTTP request cancelled"));
    };
    requestEvents?.once("aborted", requestAborted);
    const hardTimer = setTimeout(() => {
      controller.abort(new Error("order request deadline exceeded"));
    }, this.#timeoutMs);
    const softTimeoutMs = Math.max(0, this.#timeoutMs - this.#softMarginMs);
    let softTimer: NodeJS.Timeout | undefined;
    const softTimeout = new Promise<"timeout">((resolve) => {
      softTimer = setTimeout(() => {
        resolve("timeout");
      }, softTimeoutMs);
    });
    const originalTotal = input.items.reduce(
      (total, item) => total + item.quantity * (item.unit_price ?? 0),
      0
    );

    try {
      const processing = this.processItems(orderId, input.items, controller.signal);
      const outcome = await Promise.race([processing, softTimeout]);
      if (outcome === "timeout") {
        controller.abort(new Error("order soft deadline exceeded"));
        return {
          order_id: orderId,
          status: "TIMED_OUT",
          total_amount: originalTotal,
          processed_at: new Date().toISOString()
        };
      }
      const status = outcome.every((item) => item.reserved) ? "CONFIRMED" : "PARTIALLY_CONFIRMED";
      return {
        order_id: orderId,
        status,
        total_amount: outcome.reduce(
          (total, item) => total + item.requestedQty * item.unitPrice,
          0
        ),
        processed_at: new Date().toISOString(),
        confirmed_items: outcome.map((item) => ({
          item_id: item.itemId,
          sku: item.sku,
          available_qty: item.availableQty,
          reserved: item.reserved,
          status: item.status,
          ...(item.error.length === 0 ? {} : { error: item.error })
        }))
      };
    } finally {
      clearTimeout(hardTimer);
      if (softTimer !== undefined) clearTimeout(softTimer);
      requestEvents?.removeListener("aborted", requestAborted);
    }
  }

  public async close(): Promise<void> {
    await Promise.allSettled(this.#publishing);
    this.#inventory.close();
    await this.#publisher?.close();
  }

  private async processItems(
    orderId: string,
    items: readonly ProcessOrderRequestItem[],
    signal: AbortSignal
  ): Promise<readonly ItemResult[]> {
    const results: ItemResult[] = [];
    for (const item of items) {
      const unitPrice = item.unit_price ?? 0;
      try {
        const request = create(ProcessOrderItemRequestSchema, {
          orderId,
          itemId: item.item_id,
          sku: item.sku,
          quantity: item.quantity
        });
        const grpcResponse = await this.#inventory.processOrderItem(
          request,
          Date.now() + this.#timeoutMs,
          signal
        );
        results.push({
          itemId: item.item_id,
          sku: item.sku,
          requestedQty: item.quantity,
          availableQty: grpcResponse.availableQty,
          reserved: grpcResponse.reserved,
          status: grpcResponse.status,
          unitPrice,
          error: ""
        });
      } catch (error: unknown) {
        results.push({
          itemId: item.item_id,
          sku: item.sku,
          requestedQty: item.quantity,
          availableQty: 0,
          reserved: false,
          status: "PROCESSING_ERROR",
          unitPrice,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return results;
  }

  private publish(response: ProcessOrderResponse): void {
    if (this.#publisher === undefined) return;
    const confirmedItems = response.confirmed_items?.filter((item) => item.reserved).length ?? 0;
    const event: OrderProcessed = {
      orderId: response.order_id,
      status: response.status,
      processedAt: new Date(response.processed_at),
      totalItems: response.confirmed_items?.length ?? 0,
      confirmedItems,
      failureReason: response.status === "CONFIRMED" ? "" : response.status
    };
    const operation = this.#publisher.publish(event).catch((error: unknown) => {
      console.error("publish OrderProcessed failed", error);
    });
    this.#publishing.add(operation);
    void operation.finally(() => this.#publishing.delete(operation));
  }
}

class RequestError extends Error {
  public constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    length += buffer.length;
    if (length > maximumBodyBytes) throw new RequestError(413, "request body too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "invalid JSON body");
  }
}

function decodeRequest(value: unknown): ProcessOrderRequest {
  if (!isRecord(value) || !Array.isArray(value.items))
    throw new RequestError(400, "invalid JSON body");
  const items = value.items;
  if (items.length === 0) throw new RequestError(400, "items must not be empty");
  const decoded = items.map(decodeItem);
  const customerId = optionalString(value, "customer_id");
  return { ...(customerId === undefined ? {} : { customer_id: customerId }), items: decoded };
}

function decodeItem(value: unknown): ProcessOrderRequestItem {
  if (!isRecord(value)) throw new RequestError(400, "invalid JSON body");
  const quantity = requiredInt32(value, "quantity");
  if (quantity <= 0) throw new RequestError(400, "all quantities must be positive");
  const unitPrice = optionalNumber(value, "unit_price");
  return {
    item_id: requiredString(value, "item_id"),
    sku: requiredString(value, "sku"),
    quantity,
    ...(unitPrice === undefined ? {} : { unit_price: unitPrice })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new RequestError(400, "invalid JSON body");
  return field;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new RequestError(400, "invalid JSON body");
  return field;
}

function requiredInt32(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (
    typeof field !== "number" ||
    !Number.isInteger(field) ||
    field < -2_147_483_648 ||
    field > 2_147_483_647
  )
    throw new RequestError(400, "invalid JSON body");
  return field;
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "number" || !Number.isFinite(field))
    throw new RequestError(400, "invalid JSON body");
  return field;
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
