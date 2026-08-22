import type { Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";

export function terminationSignal(): AbortSignal {
  const controller = new AbortController();
  const stop = (signal: NodeJS.Signals): void => {
    controller.abort(new Error(`received ${signal}`));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return controller.signal;
}

export async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

export function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true }
    );
  });
}

export function isMain(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && moduleUrl === pathToFileURL(entrypoint).href;
}
