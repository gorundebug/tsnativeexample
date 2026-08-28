ARG DEPENDENCY_DOCKER_REGISTRY=docker.io
FROM ${DEPENDENCY_DOCKER_REGISTRY}/library/node:24.19.0-bookworm-slim AS development
ARG TARGETARCH
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ARG DEPENDENCY_APT_DEBIAN_URL=
ARG DEPENDENCY_APT_DEBIAN_SECURITY_URL=
ENV CI=true \
    NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN --mount=type=cache,id=servicegen-typescript-native-pnpm-11.18.0-${TARGETARCH},target=/pnpm/store,sharing=locked \
    corepack pnpm config set store-dir /pnpm/store \
    && corepack pnpm install --frozen-lockfile
COPY . .

FROM development AS native-debug
RUN --mount=type=cache,id=servicegen-typescript-native-apt-${TARGETARCH},target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=servicegen-typescript-native-apt-lists-${TARGETARCH},target=/var/lib/apt/lists,sharing=locked \
    if [ -n "${DEPENDENCY_APT_DEBIAN_URL}${DEPENDENCY_APT_DEBIAN_SECURITY_URL}" ]; then \
      find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -exec sed -i \
        -e "s|http://deb.debian.org/debian-security|${DEPENDENCY_APT_DEBIAN_SECURITY_URL}|g" \
        -e "s|http://deb.debian.org/debian|${DEPENDENCY_APT_DEBIAN_URL}|g" {} +; \
    fi \
    && rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gdb procps

FROM development AS check
RUN corepack pnpm check

FROM development AS builder
RUN corepack pnpm build

FROM builder AS deploy-runtimes
RUN corepack pnpm --filter @gorundebug/tsnativeexample-inventory-runtime \
      deploy --prod /deploy/inventoryservice \
    && corepack pnpm --filter @gorundebug/tsnativeexample-orders-runtime \
      deploy --prod /deploy/orderservice \
    && corepack pnpm --filter @gorundebug/tsnativeexample-analytics-runtime \
      deploy --prod /deploy/analyticsservice

FROM ${DEPENDENCY_DOCKER_REGISTRY}/library/node:24.19.0-bookworm-slim AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /workspace/dist/src/common /app/dist/src/common
COPY --from=builder /workspace/scripts/node-diagnostics.mjs /app/scripts/node-diagnostics.mjs
RUN mkdir -p /tmp/node-diagnostics && chown node:node /tmp/node-diagnostics
USER node

FROM runtime-base AS inventoryservice
COPY --from=deploy-runtimes /deploy/inventoryservice/package.json /app/package.json
COPY --from=deploy-runtimes /deploy/inventoryservice/node_modules /app/node_modules
COPY --from=builder /workspace/dist/src/generated /app/dist/src/generated
COPY --from=builder /workspace/dist/src/inventory /app/dist/src/inventory
ENTRYPOINT ["node", "--enable-source-maps", "--report-on-fatalerror", "--report-on-signal", "--report-signal=SIGUSR1", "--report-directory=/tmp/node-diagnostics", "--diagnostic-dir=/tmp/node-diagnostics", "--import=/app/scripts/node-diagnostics.mjs", "dist/src/inventory/main.js"]

FROM runtime-base AS orderservice
COPY --from=deploy-runtimes /deploy/orderservice/package.json /app/package.json
COPY --from=deploy-runtimes /deploy/orderservice/node_modules /app/node_modules
COPY --from=builder /workspace/dist/src/generated /app/dist/src/generated
COPY --from=builder /workspace/dist/src/orders /app/dist/src/orders
ENTRYPOINT ["node", "--enable-source-maps", "--report-on-fatalerror", "--report-on-signal", "--report-signal=SIGUSR1", "--report-directory=/tmp/node-diagnostics", "--diagnostic-dir=/tmp/node-diagnostics", "--import=/app/scripts/node-diagnostics.mjs", "dist/src/orders/main.js"]

FROM runtime-base AS analyticsservice
COPY --from=deploy-runtimes /deploy/analyticsservice/package.json /app/package.json
COPY --from=deploy-runtimes /deploy/analyticsservice/node_modules /app/node_modules
COPY --from=builder /workspace/dist/src/analytics /app/dist/src/analytics
ENTRYPOINT ["node", "--enable-source-maps", "--report-on-fatalerror", "--report-on-signal", "--report-signal=SIGUSR1", "--report-directory=/tmp/node-diagnostics", "--diagnostic-dir=/tmp/node-diagnostics", "--import=/app/scripts/node-diagnostics.mjs", "dist/src/analytics/main.js"]
