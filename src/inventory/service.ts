import { create } from "@bufbuild/protobuf";
import type { handleUnaryCall } from "@grpc/grpc-js";

import {
  ProcessOrderItemResponseSchema,
  type ProcessOrderItemRequest,
  type ProcessOrderItemResponse
} from "../generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";

export class InventoryService {
  readonly #stock = new Map<string, number>([
    ["SKU-001", 100],
    ["SKU-002", 50],
    ["SKU-003", 25]
  ]);
  readonly #delayMs: number;

  public constructor(delayMs: number) {
    this.#delayMs = delayMs;
  }

  public processOrderItem(): handleUnaryCall<ProcessOrderItemRequest, ProcessOrderItemResponse> {
    return (call, callback) => {
      void this.process(call.request, call).then(
        (response) => {
          callback(null, response);
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      );
    };
  }

  public async process(
    request: ProcessOrderItemRequest,
    cancellation?: NodeJS.EventEmitter
  ): Promise<ProcessOrderItemResponse> {
    if (this.#delayMs > 0) await cancellableDelay(this.#delayMs, cancellation);

    // JavaScript runs this mutation without an await, so no other request can
    // interleave between reading and writing the stock value.
    const available = this.#stock.get(request.sku) ?? 0;
    const reserved = available >= request.quantity;
    if (reserved) this.#stock.set(request.sku, available - request.quantity);
    return create(ProcessOrderItemResponseSchema, {
      availableQty: reserved ? request.quantity : available,
      reserved,
      status: reserved ? "CONFIRMED" : "OUT_OF_STOCK"
    });
  }
}

function cancellableDelay(milliseconds: number, events?: NodeJS.EventEmitter): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function cancelled(): void {
      clearTimeout(timer);
      events?.removeListener("cancelled", cancelled);
      reject(new Error("gRPC call cancelled"));
    }
    function done(): void {
      events?.removeListener("cancelled", cancelled);
      resolve();
    }
    events?.once("cancelled", cancelled);
  });
}
