# TypeScript native example

This is the hand-written native baseline for the generated TypeScript example.
It uses the same Node.js HTTP, protobuf, `grpc-js` and Confluent Kafka libraries,
but it does not import `tsservicelib`.

The Order service preserves the canonical behavior: it validates the same JSON
request, processes items sequentially through Inventory gRPC, applies the hard
and soft deadlines, returns the same status and item fields, and optionally
publishes the same `OrderProcessed` Kafka message. Analytics consumes that
message and counts successful and unsuccessful orders. Inventory updates stock
synchronously on the event loop, so no request can interleave inside the
read-modify-write operation.

## Docker-first start

Only Docker with Compose v2 is required:

```sh
bash ./quickstart.sh
```

The first run downloads the pinned Node and package dependencies. Later builds
reuse the versioned BuildKit pnpm cache. Each service has its own minimal runtime
image. For source-mounted development images, run `make dev-up`.

Useful commands:

```sh
make test          # lint, typecheck and unit tests in Docker
make coverage      # run the native baseline with Node source coverage
make event-loop-stress # prove synchronous work is visible as event-loop pressure
make docker-build  # build all independent runtime images
make docker-up     # start the normal Kafka-enabled example
make docker-down   # stop services and remove project volumes
make debug-orderservice # inspector on localhost:2347; dependencies start too
```

The debug-only image contains GDB for native Kafka-addon failures, enables
`SYS_PTRACE`, core dumps and abort-on-uncaught-exception; production images do
not contain GDB or build tools. Inspector
ports are 2345/2346/2347 for Inventory/Analytics/Order. Source maps are
enabled. Send `SIGUSR1` to write a Node diagnostic report or `SIGUSR2` to write
a heap snapshot under `.artifacts/node-diagnostics/<service>` in debug mode,
or `/tmp/node-diagnostics` in a minimal runtime container.

The HTTP endpoint is `POST http://localhost:9091/v1/processorder`. Status and
metrics endpoints are exposed by Order, Inventory and Analytics on ports 9091,
9092 and 9093 respectively. Set `ORDER_PROCESSED_ENABLED=false` in an override
for benchmark or profiling runs; in that mode no Kafka producer is created and
no broker connection is attempted.

From a sibling workspace, `make benchmark` runs the native benchmark and
`make profile` collects its profiles using the toolkits embedded in the
adjacent `conformance` checkout. Set `CONFORMANCE_DIR` when it is not adjacent,
and pass extra runner flags through
`BENCHMARK_ARGS`/`PROFILING_ARGS`.
