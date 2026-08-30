.PHONY: build test coverage event-loop-stress lint typecheck check run docker-build docker-up docker-down dev-up debug-inventoryservice debug-analyticsservice debug-orderservice debug-down profile benchmark clean

CONFORMANCE_DIR ?= $(abspath ../conformance)
BENCHMARK_ARGS ?=
PROFILING_ARGS ?=

build:
	docker build --target builder -t tsnativeexample-builder:local .

test:
	docker build --target check -t tsnativeexample-check:local .

coverage:
	corepack pnpm test:coverage

event-loop-stress:
	corepack pnpm test:event-loop-stress

lint:
	corepack pnpm lint

typecheck:
	corepack pnpm typecheck

check:
	corepack pnpm check

run: docker-up

docker-build:
	docker compose build

docker-up:
	docker compose up --build --detach

docker-down:
	docker compose down --volumes --remove-orphans

dev-up:
	docker compose -f docker-compose.yml -f docker-compose.development.yml up --build --detach

debug-inventoryservice:
	docker compose -f docker-compose.yml -f docker-compose.development.yml -f docker-compose.debug.yml up --build --detach inventoryservice

debug-analyticsservice:
	docker compose -f docker-compose.yml -f docker-compose.development.yml -f docker-compose.debug.yml up --build --detach analyticsservice

debug-orderservice:
	docker compose -f docker-compose.yml -f docker-compose.development.yml -f docker-compose.debug.yml up --build --detach orderservice

debug-down:
	docker compose -f docker-compose.yml -f docker-compose.development.yml -f docker-compose.debug.yml down --volumes --remove-orphans

benchmark:
	@test -f "$(CONFORMANCE_DIR)/benchmarks/examples/run.py" || { \
		echo "ERROR: conformance checkout not found at $(CONFORMANCE_DIR); set CONFORMANCE_DIR" >&2; \
		exit 1; \
	}
	@BENCHMARK_DEPENDENCIES_DIR="$(abspath ..)" python3 \
		"$(CONFORMANCE_DIR)/benchmarks/examples/run.py" --language typescript-native $(BENCHMARK_ARGS)

profile:
	@test -f "$(CONFORMANCE_DIR)/profiling/examples/run.py" || { \
		echo "ERROR: conformance checkout not found at $(CONFORMANCE_DIR); set CONFORMANCE_DIR" >&2; \
		exit 1; \
	}
	@PROFILING_DEPENDENCIES_DIR="$(abspath ..)" python3 \
		"$(CONFORMANCE_DIR)/profiling/examples/run.py" --language typescript-native $(PROFILING_ARGS)

clean:
	corepack pnpm clean
