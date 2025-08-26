# FlakeGuard Worker - Production Multi-Architecture Dockerfile
# Optimized for background processing with security and performance focus

# =============================================================================
# Build Arguments and Metadata
# =============================================================================
ARG NODE_VERSION=20
ARG ALPINE_VERSION=3.19
ARG PNPM_VERSION=10.0.0
ARG BUILDKIT_INLINE_CACHE=1
ARG VERSION=latest

# =============================================================================
# DEPENDENCIES STAGE
# =============================================================================
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps

# Re-declare build args for this stage
ARG PNPM_VERSION=10.0.0
ARG NPM_TOKEN

# Install build dependencies
RUN apk add --no-cache \
    libc6-compat \
    ca-certificates \
    python3 \
    make \
    g++

# Create non-root user for build
RUN addgroup -g 1001 -S builder && \
    adduser -S -D -H -u 1001 -s /sbin/nologin builder -G builder

WORKDIR /app

# Configure npm registry and authentication
RUN npm config set registry https://registry.npmjs.org/ && \
    if [ -n "${NPM_TOKEN}" ]; then \
        echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc; \
    fi

# Install pnpm with specific version and retry logic
RUN for i in 1 2 3; do \
        npm install -g pnpm@${PNPM_VERSION} && break || \
        echo "Retry $i: Failed to install pnpm@${PNPM_VERSION}, waiting 5 seconds..." && sleep 5; \
    done && \
    pnpm --version

# Copy package files for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/worker/package.json ./apps/worker/
COPY apps/api/prisma ./apps/api/prisma

# Change ownership and install dependencies
RUN chown -R builder:builder /app
USER builder

# Configure PNPM for non-root user
ENV PNPM_HOME=/tmp/.pnpm
ENV PATH=$PNPM_HOME:$PATH

# Install all dependencies (including dev for building)
RUN pnpm install --frozen-lockfile

# =============================================================================
# SHARED PACKAGE BUILD STAGE
# =============================================================================
FROM deps AS shared-builder

# Copy shared package source and root tsconfig
COPY --chown=builder:builder packages/shared/src ./packages/shared/src
COPY --chown=builder:builder packages/shared/tsconfig.json ./packages/shared/
COPY --chown=builder:builder tsconfig.json ./

# Build shared package
RUN pnpm --filter @flakeguard/shared build

# =============================================================================
# APPLICATION BUILD STAGE
# =============================================================================
FROM deps AS builder

# Copy built shared package
COPY --from=shared-builder --chown=builder:builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-builder --chown=builder:builder /app/packages/shared/package.json ./packages/shared/
COPY --from=shared-builder --chown=builder:builder /app/packages/shared/tsconfig.json ./packages/shared/

# Copy worker source code
COPY --chown=builder:builder apps/worker ./apps/worker
COPY --chown=builder:builder tsconfig.json ./

# Build worker application
RUN pnpm --filter @flakeguard/worker build

# Prune to production dependencies only
# Note: Using --ignore-scripts to prevent build scripts from running during deploy
RUN pnpm --filter @flakeguard/worker --prod --ignore-scripts deploy pruned/worker

# =============================================================================
# RUNTIME STAGE - Minimal production image
# =============================================================================
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

# Security and build metadata
LABEL maintainer="FlakeGuard Team <team@flakeguard.dev>" \
      version="${VERSION}" \
      description="FlakeGuard Background Worker - Test analysis and processing" \
      org.opencontainers.image.title="FlakeGuard Worker" \
      org.opencontainers.image.description="Production-ready background worker for flaky test processing" \
      org.opencontainers.image.source="https://github.com/flakeguard/flakeguard" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="FlakeGuard" \
      org.opencontainers.image.licenses="Apache-2.0"

# Install minimal runtime dependencies and security updates
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache \
        ca-certificates \
        tzdata \
        dumb-init \
        tini \
        curl \
    && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

# Create application user with minimal privileges
RUN addgroup -g 1001 -S flakeguard && \
    adduser -S -D -H -u 1001 -s /sbin/nologin flakeguard -G flakeguard

# Create application and temporary directories
RUN mkdir -p /app /var/log/flakeguard /tmp/flakeguard && \
    chown -R flakeguard:flakeguard /app /var/log/flakeguard /tmp/flakeguard && \
    chmod 755 /app /var/log/flakeguard && \
    chmod 1777 /tmp/flakeguard

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=flakeguard:flakeguard /app/pruned/worker/node_modules ./node_modules
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/worker/dist ./dist
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/worker/package.json ./
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/package.json ./packages/shared/

# Set secure permissions
RUN find /app -type f -exec chmod 644 {} \; && \
    find /app -type d -exec chmod 755 {} \; && \
    chmod +x /app/dist/index.js

# Create health check script
RUN echo 'const http = require("http"); \
const options = { \
  hostname: "localhost", \
  port: 8080, \
  path: "/health", \
  timeout: 5000, \
  method: "GET" \
}; \
const req = http.request(options, (res) => { \
  console.log(`Worker health check status: ${res.statusCode}`); \
  process.exit(res.statusCode === 200 ? 0 : 1); \
}); \
req.on("error", (err) => { \
  console.error("Worker health check failed:", err.message); \
  process.exit(1); \
}); \
req.on("timeout", () => { \
  console.error("Worker health check timeout"); \
  req.destroy(); \
  process.exit(1); \
}); \
req.setTimeout(5000); \
req.end();' > healthcheck.js && \
chown flakeguard:flakeguard healthcheck.js && \
chmod +x healthcheck.js

# Switch to non-root user
USER flakeguard

# Environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=1024" \
    WORKER_NAME=flakeguard-worker \
    LOG_LEVEL=info \
    HEALTH_CHECK_PORT=8080 \
    METRICS_PORT=9090 \
    VERSION=${VERSION}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node healthcheck.js || exit 1

# Expose health check and metrics ports
EXPOSE 8080 9090

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the worker
CMD ["node", "dist/index.js"]

# =============================================================================
# DEVELOPMENT STAGE (Optional)
# =============================================================================
FROM runtime AS development

USER root

# Install development tools
RUN apk add --no-cache \
        git \
        vim \
    && rm -rf /var/cache/apk/*

# Install pnpm for development with retry logic
RUN npm config set registry https://registry.npmjs.org/ && \
    for i in 1 2 3; do \
        npm install -g pnpm@${PNPM_VERSION} && break || \
        echo "Retry $i: Failed to install pnpm, waiting 5 seconds..." && sleep 5; \
    done

# Switch back to app user
USER flakeguard

ENV NODE_ENV=development \
    LOG_LEVEL=debug

# Override command for development
CMD ["pnpm", "dev"]