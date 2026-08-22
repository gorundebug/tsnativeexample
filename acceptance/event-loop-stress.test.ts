import assert from "node:assert/strict";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import test from "node:test";

import { create } from "@bufbuild/protobuf";

import { ProcessOrderItemRequestSchema } from "../src/generated/inventoryserviceapi/processorderitem/processorderitem_pb.js";
import { InventoryService } from "../src/inventory/service.js";

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

void test("native synchronous service work is visible as event-loop saturation", async () => {
  const service = new InventoryService(0);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  let previous = performance.eventLoopUtilization();
  delay.enable();
  try {
    await timer(30);
    const operations: Promise<unknown>[] = [];
    const until = performance.now() + 80;
    let sequence = 0;
    while (performance.now() < until) {
      operations.push(
        service.process(
          create(ProcessOrderItemRequestSchema, {
            orderId: `order-${String(sequence)}`,
            itemId: `item-${String(sequence)}`,
            sku: "missing",
            quantity: 1
          })
        )
      );
      sequence += 1;
    }
    await Promise.all(operations);
    await timer(30);

    const current = performance.eventLoopUtilization();
    const utilization = performance.eventLoopUtilization(current, previous).utilization;
    previous = current;
    const lagMs = delay.max / NANOSECONDS_PER_MILLISECOND;
    assert.ok(sequence > 0, "the stress loop executed no service operations");
    assert.ok(lagMs >= 40, `expected at least 40ms event-loop lag, received ${String(lagMs)}ms`);
    assert.ok(
      utilization >= 0.3,
      `expected at least 30% event-loop utilization, received ${String(utilization)}`
    );
  } finally {
    delay.disable();
  }
});

function timer(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
