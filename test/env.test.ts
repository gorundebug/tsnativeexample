import assert from "node:assert/strict";
import test from "node:test";

import { envBoolean, envDurationMs, envInteger } from "../src/common/env.js";

void test("environment helpers parse canonical values", () => {
  process.env.TEST_NATIVE_INTEGER = "6";
  process.env.TEST_NATIVE_DURATION = "1.5s";
  process.env.TEST_NATIVE_BOOLEAN = "false";
  assert.equal(envInteger("TEST_NATIVE_INTEGER", 1), 6);
  assert.equal(envDurationMs("TEST_NATIVE_DURATION", 0), 1_500);
  assert.equal(envBoolean("TEST_NATIVE_BOOLEAN", true), false);
  delete process.env.TEST_NATIVE_INTEGER;
  delete process.env.TEST_NATIVE_DURATION;
  delete process.env.TEST_NATIVE_BOOLEAN;
});
