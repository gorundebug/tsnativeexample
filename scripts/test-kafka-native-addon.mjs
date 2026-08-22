import assert from "node:assert/strict";
import process from "node:process";

const kafka = await import("@confluentinc/kafka-javascript");
assert.equal(typeof kafka.KafkaJS.Kafka, "function");

const client = new kafka.KafkaJS.Kafka({
  kafkaJS: {
    brokers: ["127.0.0.1:1"],
    clientId: "native-addon-sanitizer-smoke"
  }
});
const producer = client.producer();
await producer.disconnect();
process.stdout.write("Kafka native addon sanitizer smoke: PASS\n");
