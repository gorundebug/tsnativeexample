import { createServer } from "node:http";

import { env, envBoolean, envList } from "../common/env.js";
import { OrderEventConsumer, type OrderProcessed } from "../common/kafka.js";
import { closeHttpServer, isMain, terminationSignal, waitForAbort } from "../common/lifecycle.js";
import { handleStatus } from "../common/status.js";

class OrderCounters {
  #successful = 0;
  #unsuccessful = 0;

  public consume(value: OrderProcessed): void {
    if (value.status === "CONFIRMED") this.#successful += 1;
    else this.#unsuccessful += 1;
  }

  public metrics(): string {
    return [
      "# HELP analytics_orders_total Number of processed orders by result",
      "# TYPE analytics_orders_total counter",
      `analytics_orders_total{result="successful"} ${String(this.#successful)}`,
      `analytics_orders_total{result="unsuccessful"} ${String(this.#unsuccessful)}`,
      ""
    ].join("\n");
  }
}

export async function runAnalyticsService(signal = terminationSignal()): Promise<void> {
  const startedAt = new Date();
  const counters = new OrderCounters();
  const kafkaEnabled = envBoolean("ORDER_PROCESSED_ENABLED", false);
  const consumer = kafkaEnabled
    ? await OrderEventConsumer.connect(
        envList("ORDER_EVENTS_BROKERS", ["redpanda:9092"]),
        env("ORDER_PROCESSED_TOPIC", "order-processed"),
        env("ORDER_PROCESSED_GROUP_ID", "analytics-service"),
        (value) => {
          counters.consume(value);
        }
      )
    : undefined;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      response.end(counters.metrics());
      return;
    }
    if (!handleStatus("analyticsservice", startedAt, request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await listen(
    server,
    Number(env("ANALYTICS_SERVICE_HTTP_PORT", "9093")),
    env("ANALYTICS_SERVICE_HTTP_HOST", "0.0.0.0")
  );
  await waitForAbort(signal);
  await closeHttpServer(server);
  await consumer?.close();
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
  runAnalyticsService().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
