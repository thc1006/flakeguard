# FlakeGuard Web Dashboard - Production Multi-Architecture Dockerfile
# Optimized for Next.js with security and performance best practices

# =============================================================================
# Build Arguments and Metadata
# =============================================================================
ARG NODE_VERSION=20
ARG ALPINE_VERSION=3.19
ARG PNPM_VERSION=10.0.0
ARG BUILDKIT_INLINE_CACHE=1
ARG VERSION=latest

# =============================================================================
# BASE STAGE
# =============================================================================
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

# Install system dependencies
RUN apk add --no-cache \
    libc6-compat \
    ca-certificates \
    tzdata

# Install pnpm globally
RUN npm install -g pnpm@${PNPM_VERSION}

# =============================================================================
# DEPENDENCIES STAGE
# =============================================================================
FROM base AS deps

# Create non-root user for build
RUN addgroup -g 1001 -S builder && \
    adduser -S -D -H -u 1001 -s /sbin/nologin builder -G builder

WORKDIR /app

# Copy package files for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Change ownership and install dependencies
RUN chown -R builder:builder /app
USER builder

# Set PNPM_HOME to a writable location for the builder user
ENV PNPM_HOME=/tmp/.pnpm
ENV PATH=$PNPM_HOME:$PATH

# Install dependencies
RUN pnpm install --frozen-lockfile

# =============================================================================
# SHARED PACKAGE BUILD STAGE
# =============================================================================
FROM deps AS shared-builder

# Copy shared package source and root tsconfig
COPY --chown=builder:builder packages/shared/src ./packages/shared/src
COPY --chown=builder:builder packages/shared/tsconfig.json ./packages/shared/
COPY --chown=builder:builder packages/shared/package.json ./packages/shared/
COPY --chown=builder:builder tsconfig.json ./

# Build shared package
RUN pnpm --filter @flakeguard/shared build

# =============================================================================
# APPLICATION BUILD STAGE
# =============================================================================
FROM deps AS builder

# Copy built shared package
COPY --from=shared-builder --chown=builder:builder /app/packages/shared ./packages/shared
COPY --from=shared-builder --chown=builder:builder /app/packages/shared/tsconfig.json ./packages/shared/

# Copy web app source
COPY --chown=builder:builder apps/web ./apps/web
COPY --chown=builder:builder package.json pnpm-workspace.yaml tsconfig.json ./

# Set build environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV SKIP_ENV_VALIDATION=1

# Build the web application
WORKDIR /app/apps/web
RUN pnpm build

# =============================================================================
# PRODUCTION RUNTIME STAGE
# =============================================================================
FROM base AS runtime

# Security and build metadata
LABEL maintainer="FlakeGuard Team <team@flakeguard.dev>" \
      version="${VERSION}" \
      description="FlakeGuard Web Dashboard - Next.js frontend application" \
      org.opencontainers.image.title="FlakeGuard Web" \
      org.opencontainers.image.description="Production-ready web dashboard for flaky test management" \
      org.opencontainers.image.source="https://github.com/flakeguard/flakeguard" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.vendor="FlakeGuard" \
      org.opencontainers.image.licenses="Apache-2.0"

# Install runtime dependencies
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache \
        ca-certificates \
        tzdata \
        dumb-init \
        tini \
        curl \
    && rm -rf /var/cache/apk/* /tmp/* /var/tmp/*

WORKDIR /app

# Create application user
RUN addgroup -g 1001 -S flakeguard && \
    adduser -S -D -H -u 1001 -s /sbin/nologin flakeguard -G flakeguard

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV VERSION=${VERSION}

# Copy public assets
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/web/public ./public

# Create .next directory with proper permissions
RUN mkdir -p .next && chown -R flakeguard:flakeguard .next

# Copy built application
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/web/.next/standalone ./
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/web/.next/static ./.next/static

# Copy shared package for runtime
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/package.json ./packages/shared/

# Create health check script
RUN echo 'const http = require("http"); \
const options = { \
  hostname: "localhost", \
  port: 3001, \
  path: "/api/health", \
  timeout: 3000, \
  method: "GET" \
}; \
const req = http.request(options, (res) => { \
  console.log(`Health check status: ${res.statusCode}`); \
  process.exit(res.statusCode === 200 ? 0 : 1); \
}); \
req.on("error", (err) => { \
  console.error("Health check failed:", err.message); \
  process.exit(1); \
}); \
req.on("timeout", () => { \
  console.error("Health check timeout"); \
  req.destroy(); \
  process.exit(1); \
}); \
req.setTimeout(3000); \
req.end();' > healthcheck.js && \
chown flakeguard:flakeguard healthcheck.js

# Set secure permissions
RUN find /app -type f -exec chmod 644 {} \; && \
    find /app -type d -exec chmod 755 {} \; && \
    chmod +x /app/server.js /app/healthcheck.js

# Switch to non-root user
USER flakeguard

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node healthcheck.js || exit 1

# Expose port
EXPOSE 3001

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "server.js"]

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

# Install pnpm for development
RUN npm install -g pnpm@${PNPM_VERSION}

# Switch back to app user
USER flakeguard

ENV NODE_ENV=development

# Override command for development
CMD ["pnpm", "dev"]
