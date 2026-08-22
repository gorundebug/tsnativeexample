import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { writeHeapSnapshot } from "node:v8";
import { isMainThread } from "node:worker_threads";

const diagnosticsDirectory = process.env.NODE_DIAGNOSTIC_DIR ?? "/tmp/node-diagnostics";
mkdirSync(diagnosticsDirectory, { recursive: true });
process.report.directory = diagnosticsDirectory;

let snapshotSequence = 0;
if (isMainThread) {
  process.on("SIGUSR2", () => {
    snapshotSequence += 1;
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const filename = join(
      diagnosticsDirectory,
      `Heap.${timestamp}.${process.pid}.${snapshotSequence}.heapsnapshot`
    );
    try {
      const output = writeHeapSnapshot(filename);
      process.stderr.write(`[diagnostics] heap snapshot written to ${output}\n`);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`[diagnostics] heap snapshot failed: ${message}\n`);
    }
  });
}
