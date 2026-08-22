import assert from "node:assert/strict";
import test from "node:test";

import { create } from "@bufbuild/protobuf";

import {
  ProcessOrderItemResponseSchema,
  type ProcessOrderItemRequest,
  type ProcessOrderItemResponse
} from "../src/generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";
import { OrderService, type InventoryClient } from "../src/orders/service.js";

class FakeInventory implements InventoryClient {
  readonly requests: ProcessOrderItemRequest[] = [];
  readonly #responses: readonly ProcessOrderItemResponse[];

  public constructor(responses: readonly ProcessOrderItemResponse[]) {
    this.#responses = responses;
  }

  public processOrderItem(request: ProcessOrderItemRequest): Promise<ProcessOrderItemResponse> {
    this.requests.push(request);
    const response = this.#responses[this.requests.length - 1];
    return response === undefined
      ? Promise.reject(new Error("missing fake response"))
      : Promise.resolve(response);
  }

  public close(): void {
    return;
  }
}

void test("order processing is sequential and preserves the Go native response semantics", async () => {
  const inventory = new FakeInventory([
    create(ProcessOrderItemResponseSchema, {
      availableQty: 2,
      reserved: true,
      status: "CONFIRMED"
    }),
    create(ProcessOrderItemResponseSchema, {
      availableQty: 1,
      reserved: false,
      status: "OUT_OF_STOCK"
    })
  ]);
  const service = new OrderService(inventory, 5_000, 1_000);
  const response = await service.process(
    {
      customer_id: "customer-1",
      items: [
        { item_id: "item-1", sku: "SKU-001", quantity: 2, unit_price: 10 },
        { item_id: "item-2", sku: "SKU-002", quantity: 3, unit_price: 20 }
      ]
    },
    "order-1"
  );
  assert.equal(response.order_id, "order-1");
  assert.equal(response.status, "PARTIALLY_CONFIRMED");
  assert.equal(response.total_amount, 80);
  assert.deepEqual(
    inventory.requests.map((request) => request.itemId),
    ["item-1", "item-2"]
  );
  assert.deepEqual(response.confirmed_items, [
    {
      item_id: "item-1",
      sku: "SKU-001",
      available_qty: 2,
      reserved: true,
      status: "CONFIRMED"
    },
    {
      item_id: "item-2",
      sku: "SKU-002",
      available_qty: 1,
      reserved: false,
      status: "OUT_OF_STOCK"
    }
  ]);
  await service.close();
});

void test("soft deadline returns TIMED_OUT with the submitted total", async () => {
  const inventory: InventoryClient = {
    processOrderItem: (_request, _deadline, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("cancelled"));
          },
          { once: true }
        );
      }),
    close: () => undefined
  };
  const service = new OrderService(inventory, 20, 10);
  const response = await service.process(
    { items: [{ item_id: "item-1", sku: "SKU-001", quantity: 2, unit_price: 7.5 }] },
    "order-timeout"
  );
  assert.equal(response.status, "TIMED_OUT");
  assert.equal(response.total_amount, 15);
  assert.equal(response.confirmed_items, undefined);
  await service.close();
});
