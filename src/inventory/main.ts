import { createServer } from "node:http";

import { Server, ServerCredentials } from "@grpc/grpc-js";

import { env, envDurationMs } from "../common/env.js";
import { serviceDefinition } from "../common/grpc.js";
import { closeHttpServer, isMain, terminationSignal, waitForAbort } from "../common/lifecycle.js";
import { handleStatus } from "../common/status.js";
import { InventoryServiceApi } from "../generated/inventoryserviceapi/inventoryserviceapi.generated_pb.js";
import { InventoryService } from "./service.js";

export async function runInventoryService(signal = terminationSignal()): Promise<void> {
  const startedAt = new Date();
  const service = new InventoryService(envDurationMs("INVENTORY_SERVICE_RESPONSE_DELAY", 0));
  const grpcServer = new Server();
  grpcServer.addService(serviceDefinition(InventoryServiceApi), {
    processOrderItem: service.processOrderItem()
  });
  const grpcAddress = `${env("INVENTORY_SERVICE_GRPC_HOST", "0.0.0.0")}:${env("INVENTORY_SERVICE_GRPC_PORT", "9202")}`;
  await bind(grpcServer, grpcAddress);

  const httpServer = createServer((request, response) => {
    if (!handleStatus("inventoryservice", startedAt, request, response)) {
      response.writeHead(404);
      response.end();
    }
  });
  await listen(
    httpServer,
    Number(env("INVENTORY_SERVICE_HTTP_PORT", "9092")),
    env("INVENTORY_SERVICE_HTTP_HOST", "0.0.0.0")
  );

  await waitForAbort(signal);
  await closeHttpServer(httpServer);
  await shutdownGrpc(grpcServer);
}

function bind(server: Server, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.bindAsync(address, ServerCredentials.createInsecure(), (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

function shutdownGrpc(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.forceShutdown();
      resolve();
    }, 5_000);
    server.tryShutdown(() => {
      clearTimeout(timer);
      resolve();
    });
  });
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
  runInventoryService().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
