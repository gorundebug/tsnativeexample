import {
  Client,
  Metadata,
  credentials,
  type ClientUnaryCall,
  type ServiceDefinition
} from "@grpc/grpc-js";
import {
  fromBinary,
  toBinary,
  type DescMessage,
  type DescMethod,
  type DescService,
  type MessageShape
} from "@bufbuild/protobuf";

export function serviceDefinition(service: DescService): ServiceDefinition {
  return Object.fromEntries(
    service.methods.map((method) => [
      method.localName,
      {
        path: `/${service.typeName}/${method.name}`,
        requestStream:
          method.methodKind === "client_streaming" || method.methodKind === "bidi_streaming",
        responseStream:
          method.methodKind === "server_streaming" || method.methodKind === "bidi_streaming",
        requestSerialize: (value: unknown) => Buffer.from(serialize(method.input, value)),
        requestDeserialize: (bytes: Buffer) => deserialize(method.input, bytes),
        responseSerialize: (value: unknown) => Buffer.from(serialize(method.output, value)),
        responseDeserialize: (bytes: Buffer) => deserialize(method.output, bytes)
      }
    ])
  );
}

export class UnaryClientPool {
  readonly #service: DescService;
  readonly #clients: readonly Client[];
  #next = 0;

  public constructor(address: string, count: number, service: DescService) {
    if (!Number.isSafeInteger(count) || count <= 0)
      throw new Error("inventory connection count must be positive");
    this.#service = service;
    this.#clients = Array.from(
      { length: count },
      () => new Client(address, credentials.createInsecure())
    );
  }

  public unary<Res>(
    method: DescMethod,
    request: unknown,
    deadline: number,
    signal: AbortSignal
  ): Promise<Res> {
    const client = this.#clients[this.#next % this.#clients.length];
    this.#next += 1;
    if (client === undefined) return Promise.reject(new Error("gRPC client pool is empty"));
    return new Promise((resolve, reject) => {
      const call: ClientUnaryCall = client.makeUnaryRequest(
        `/${this.#service.typeName}/${method.name}`,
        (value: unknown) => Buffer.from(serialize(method.input, value)),
        (bytes: Buffer) => deserialize(method.output, bytes) as Res,
        request,
        new Metadata(),
        { deadline },
        (error, response) => {
          signal.removeEventListener("abort", cancel);
          if (error !== null) reject(error);
          else if (response === undefined)
            reject(new Error("unary gRPC call returned no response"));
          else resolve(response);
        }
      );
      const cancel = (): void => {
        call.cancel();
      };
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    });
  }

  public close(): void {
    for (const client of this.#clients) client.close();
  }
}

function serialize(schema: DescMessage, value: unknown): Uint8Array {
  return toBinary(schema, value as MessageShape<DescMessage>);
}

function deserialize(schema: DescMessage, bytes: Uint8Array): unknown {
  return fromBinary(schema, bytes);
}
