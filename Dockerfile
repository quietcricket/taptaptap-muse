FROM debian:bookworm-slim AS opencode-download
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
# OpenCode 2.1.4 release checksums, also published in anomalyco's Homebrew tap.
RUN --mount=type=secret,id=build_ca --mount=type=cache,target=/downloads,sharing=locked \
    if [ -f /run/secrets/build_ca ]; then export CURL_CA_BUNDLE=/run/secrets/build_ca; fi; \
    case "$TARGETARCH" in \
      arm64) artifact=opencode-linux-arm64.tar.gz; checksum=759c9d6e7b246b81bcc93dfc6cc3bb2a38287c75b6202e305eacacb5dd882315 ;; \
      amd64) artifact=opencode-linux-x64-baseline.tar.gz; checksum=2edaf8cf96e81dec5ee996a3196b03345cf59e5a1673d83a4599bb4afc5c5f6d ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && archive="/downloads/2.1.4-$artifact" \
    && if ! echo "$checksum  $archive" | sha256sum --check --status; then \
      curl --fail --silent --show-error --location --connect-timeout 15 --max-time 180 \
      --retry 3 --retry-all-errors --continue-at - \
      "https://opencode.ai/files/bin/2.1.4/$artifact" -o "$archive"; \
    fi \
    && echo "$checksum  $archive" | sha256sum --check - \
    && mkdir /out && tar -xzf "$archive" -C /out \
    && test -x /out/opencode

FROM debian:bookworm-slim AS sandbox-build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/agent-sandbox.c /build/agent-sandbox.c
RUN gcc -O2 -Wall -Wextra -Werror -D_FORTIFY_SOURCE=2 \
    -fstack-protector-strong -Wl,-z,relro,-z,now \
    /build/agent-sandbox.c -o /build/taptaptap-sandbox

FROM python:3.13-slim AS runtime-base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libstdc++6 ripgrep \
    && rm -rf /var/lib/apt/lists/*
COPY --from=opencode-download /out/opencode /usr/local/bin/opencode
COPY --from=sandbox-build /build/taptaptap-sandbox /usr/local/bin/taptaptap-sandbox
COPY --chmod=755 scripts/opencode-bun.sh /usr/local/bin/bun
# One executable provides both the coding harness and its embedded Bun runtime.
RUN opencode --version && bun --version \
    && bun -e 'if (!Bun.version) process.exit(1)'

FROM runtime-base AS build
WORKDIR /app
COPY package.json bun.lock ./
# bun.lock was migrated from the pnpm lock, preserving resolved versions.
RUN --mount=type=secret,id=build_ca --mount=type=cache,target=/root/.bun/install/cache \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run node_modules/typescript/bin/tsc --noEmit \
    && bun run node_modules/vite/bin/vite.js build \
    && bun run scripts/copy-font-license.mjs \
    && bun run scripts/build-mode-runtime.mjs

FROM runtime-base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/dist DYNAMODB_TABLE=taptaptap AWS_REGION=ap-southeast-1 \
    XDG_CONFIG_HOME=/tmp/opencode/config XDG_DATA_HOME=/tmp/opencode/data \
    XDG_CACHE_HOME=/tmp/opencode/cache XDG_STATE_HOME=/tmp/opencode/state
WORKDIR /app
RUN pip install --no-cache-dir uv==0.13.1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home app
COPY src ./src
COPY scripts/build-mode.ts ./scripts/build-mode.ts
COPY --from=build /app/node_modules ./node_modules
COPY infra/opencode.json /etc/opencode/opencode.json
COPY infra/opencode.json ./infra/opencode.json
COPY --from=build /app/dist ./dist
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health', timeout=3)"]
CMD ["/app/.venv/bin/uvicorn", "server.app:create_app", "--factory", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8080", "--no-proxy-headers"]
