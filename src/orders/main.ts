import { createServer } from "node:http";

import { env, envBoolean, envDurationMs, envInteger, envList } from "../common/env.js";
import { closeHttpServer, isMain, terminationSignal, waitForAbort } from "../common/lifecycle.js";
import { handleStatus } from "../common/status.js";
import { GrpcInventoryClient } from "./inventory-client.js";
import { OrderService } from "./service.js";

export async function runOrderService(signal = terminationSignal()): Promise<void> {
  const startedAt = new Date();
  const clients = new GrpcInventoryClient(
    env("INVENTORY_SERVICE_API_ADDRESS", "inventoryservice:9202"),
    envInteger("INVENTORY_SERVICE_API_CONNECTIONS_COUNT", 1)
  );
  const kafkaEnabled = envBoolean("ORDER_PROCESSED_ENABLED", false);
  const publisher = kafkaEnabled
    ? await (
        await import("../common/kafka.js")
      ).OrderEventProducer.connect(
        envList("ORDER_EVENTS_BROKERS", ["redpanda:9092"]),
        env("ORDER_PROCESSED_TOPIC", "order-processed")
      )
    : undefined;
  const service = new OrderService(
    clients,
    envDurationMs("ORDER_SERVICE_REQUEST_TIMEOUT", 5_000),
    envDurationMs("ORDER_SERVICE_SOFT_DEADLINE_MARGIN", 1_000),
    publisher
  );
  const server = createServer((request, response) => {
    if (handleStatus("orderservice", startedAt, request, response)) return;
    void service.handle(request, response).then((handled) => {
      if (!handled && !response.writableEnded) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await listen(
    server,
    Number(env("ORDER_SERVICE_HTTP_PORT", "9091")),
    env("ORDER_SERVICE_HTTP_HOST", "0.0.0.0")
  );
  await waitForAbort(signal);
  await closeHttpServer(server);
  await service.close();
}

function listen(
  server: ReturnType<typeof createServer>,
  port: number,
  host: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

if (isMain(import.meta.url)) {
  runOrderService().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
