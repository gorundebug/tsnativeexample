import { KafkaJS } from "@confluentinc/kafka-javascript";

export interface OrderProcessed {
  readonly orderId: string;
  readonly status: string;
  readonly processedAt: Date;
  readonly totalItems: number;
  readonly confirmedItems: number;
  readonly failureReason: string;
}

export class OrderEventProducer {
  readonly #producer: KafkaJS.Producer;
  readonly #topic: string;

  private constructor(producer: KafkaJS.Producer, topic: string) {
    this.#producer = producer;
    this.#topic = topic;
  }

  public static async connect(
    brokers: readonly string[],
    topic: string
  ): Promise<OrderEventProducer> {
    const kafka = makeKafka(brokers);
    await ensureTopic(kafka, topic);
    const producer = kafka.producer();
    await producer.connect();
    return new OrderEventProducer(producer, topic);
  }

  public async publish(value: OrderProcessed): Promise<void> {
    await this.#producer.send({
      topic: this.#topic,
      messages: [
        {
          key: Buffer.from(value.orderId),
          value: Buffer.from(encodeOrderProcessed(value))
        }
      ]
    });
  }

  public async close(): Promise<void> {
    await this.#producer.flush({ timeout: 5_000 });
    await this.#producer.disconnect();
  }
}

export class OrderEventConsumer {
  readonly #consumer: KafkaJS.Consumer;
  readonly #topic: string;
  readonly #handler: (value: OrderProcessed) => void | Promise<void>;

  private constructor(
    consumer: KafkaJS.Consumer,
    topic: string,
    handler: (value: OrderProcessed) => void | Promise<void>
  ) {
    this.#consumer = consumer;
    this.#topic = topic;
    this.#handler = handler;
  }

  public static async connect(
    brokers: readonly string[],
    topic: string,
    groupId: string,
    handler: (value: OrderProcessed) => void | Promise<void>
  ): Promise<OrderEventConsumer> {
    const kafka = makeKafka(brokers);
    await ensureTopic(kafka, topic);
    const consumer = kafka.consumer({
      kafkaJS: { groupId, fromBeginning: true, autoCommit: true }
    });
    await consumer.connect();
    await consumer.subscribe({ topic });
    const result = new OrderEventConsumer(consumer, topic, handler);
    await result.start();
    return result;
  }

  public async close(): Promise<void> {
    await this.#consumer.stop();
    await this.#consumer.disconnect();
  }

  private async start(): Promise<void> {
    await this.#consumer.run({
      partitionsConsumedConcurrently: 1,
      eachMessage: async ({ topic, message }) => {
        if (topic !== this.#topic) throw new Error(`unexpected Kafka topic ${topic}`);
        if (message.value === null) throw new Error("OrderProcessed message has no value");
        await this.#handler(decodeOrderProcessed(message.value));
      }
    });
  }
}

export function encodeOrderProcessed(value: OrderProcessed): string {
  return JSON.stringify({
    order_id: value.orderId,
    status: value.status,
    processed_at: value.processedAt.toISOString(),
    total_items: value.totalItems,
    confirmed_items: value.confirmedItems,
    ...(value.failureReason.length === 0 ? {} : { failure_reason: value.failureReason })
  });
}

export function decodeOrderProcessed(bytes: Uint8Array): OrderProcessed {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isRecord(parsed)) throw new TypeError("OrderProcessed must be an object");
  const processedAt = new Date(requiredString(parsed, "processed_at"));
  if (Number.isNaN(processedAt.valueOf())) throw new TypeError("processed_at must be a date-time");
  return {
    orderId: requiredString(parsed, "order_id"),
    status: requiredString(parsed, "status"),
    processedAt,
    totalItems: requiredInteger(parsed, "total_items"),
    confirmedItems: requiredInteger(parsed, "confirmed_items"),
    failureReason: optionalString(parsed, "failure_reason") ?? ""
  };
}

function makeKafka(brokers: readonly string[]): KafkaJS.Kafka {
  return new KafkaJS.Kafka({ kafkaJS: { brokers: [...brokers] } });
}

async function ensureTopic(kafka: KafkaJS.Kafka, topic: string): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      topics: [{ topic, numPartitions: 1, replicationFactor: 1 }]
    });
  } finally {
    await admin.disconnect();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new TypeError(`${key} must be a string`);
  return field;
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new TypeError(`${key} must be a string`);
  return field;
}

function requiredInteger(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field)) throw new TypeError(`${key} must be an integer`);
  return field as number;
}
