import assert from "node:assert/strict";
import test from "node:test";

import { decodeOrderProcessed, encodeOrderProcessed } from "../src/common/kafka.js";

void test("OrderProcessed uses the canonical Kafka JSON contract", () => {
  const encoded = encodeOrderProcessed({
    orderId: "order-1",
    status: "PARTIALLY_CONFIRMED",
    processedAt: new Date("2026-08-18T00:00:00.000Z"),
    totalItems: 2,
    confirmedItems: 1,
    failureReason: "PARTIALLY_CONFIRMED"
  });
  assert.deepEqual(JSON.parse(encoded), {
    order_id: "order-1",
    status: "PARTIALLY_CONFIRMED",
    processed_at: "2026-08-18T00:00:00.000Z",
    total_items: 2,
    confirmed_items: 1,
    failure_reason: "PARTIALLY_CONFIRMED"
  });
  assert.deepEqual(decodeOrderProcessed(Buffer.from(encoded)), {
    orderId: "order-1",
    status: "PARTIALLY_CONFIRMED",
    processedAt: new Date("2026-08-18T00:00:00.000Z"),
    totalItems: 2,
    confirmedItems: 1,
    failureReason: "PARTIALLY_CONFIRMED"
  });
});
