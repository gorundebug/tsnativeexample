import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const diagnosticsDirectory = await mkdtemp(join(tmpdir(), "tsnative-diagnostics-"));
const diagnosticsModule = new URL("./node-diagnostics.mjs", import.meta.url).href;

async function waitForArtifact(prefix, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of await readdir(diagnosticsDirectory)) {
      if (name.startsWith(prefix)) {
        const metadata = await stat(join(diagnosticsDirectory, name));
        if (metadata.size > 0) return name;
      }
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for ${prefix} in ${diagnosticsDirectory}`);
}

const child = spawn(
  process.execPath,
  [
    "--report-on-signal",
    "--report-signal=SIGUSR1",
    `--report-directory=${diagnosticsDirectory}`,
    `--diagnostic-dir=${diagnosticsDirectory}`,
    `--import=${diagnosticsModule}`,
    "-e",
    "setInterval(() => undefined, 1000)"
  ],
  {
    env: { ...process.env, NODE_DIAGNOSTIC_DIR: diagnosticsDirectory },
    stdio: ["ignore", "ignore", "pipe"]
  }
);

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  await once(child, "spawn");
  await delay(100);
  assert.equal(child.kill("SIGUSR1"), true);
  const report = await waitForArtifact("report.");
  assert.match(report, /\.json$/u);

  assert.equal(child.kill("SIGUSR2"), true);
  const heap = await waitForArtifact("Heap.");
  assert.match(heap, /\.heapsnapshot$/u);
  assert.equal(child.kill("SIGTERM"), true);
  const [exitCode, signal] = await once(child, "exit");
  assert.equal(exitCode, null);
  assert.equal(signal, "SIGTERM");
  // The artifact is the contract. stderr delivery can race with SIGTERM after
  // writeHeapSnapshot has synchronously finished, especially on macOS.
  assert.doesNotMatch(stderr, /heap snapshot failed/u);
  process.stdout.write(`Node diagnostics PASS: ${report}, ${heap}\n`);
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await rm(diagnosticsDirectory, { recursive: true, force: true });
}
