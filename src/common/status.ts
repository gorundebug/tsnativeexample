import type { IncomingMessage, ServerResponse } from "node:http";

export interface NativeStatus {
  readonly service: string;
  readonly status: "ok";
  readonly started_at: string;
}

export function handleStatus(
  service: string,
  startedAt: Date,
  request: IncomingMessage,
  response: ServerResponse
): boolean {
  if (request.method !== "GET") return false;
  if (request.url === "/status/data") {
    writeJson(response, 200, {
      service,
      status: "ok",
      started_at: startedAt.toISOString()
    } satisfies NativeStatus);
    return true;
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end("# No ServiceLib runtime metrics in the native baseline.\n");
    return true;
  }
  return false;
}

export function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}
