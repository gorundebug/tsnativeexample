import assert from "node:assert/strict";
import test from "node:test";

import { create } from "@bufbuild/protobuf";

import { ProcessOrderItemRequestSchema } from "../src/generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";
import { InventoryService } from "../src/inventory/service.js";

void test("inventory reserves stock atomically and reports remaining quantity", async () => {
  const service = new InventoryService(0);
  const first = await service.process(
    create(ProcessOrderItemRequestSchema, {
      orderId: "order-1",
      itemId: "item-1",
      sku: "SKU-003",
      quantity: 20
    })
  );
  assert.deepEqual(
    { availableQty: first.availableQty, reserved: first.reserved, status: first.status },
    { availableQty: 20, reserved: true, status: "CONFIRMED" }
  );
  const second = await service.process(
    create(ProcessOrderItemRequestSchema, {
      orderId: "order-2",
      itemId: "item-2",
      sku: "SKU-003",
      quantity: 10
    })
  );
  assert.deepEqual(
    { availableQty: second.availableQty, reserved: second.reserved, status: second.status },
    { availableQty: 5, reserved: false, status: "OUT_OF_STOCK" }
  );
});
