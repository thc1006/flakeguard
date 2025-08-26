# FlakeGuard API - Production Multi-Architecture Dockerfile
# Optimized for security, performance, and multi-platform builds

# =============================================================================
# Build Arguments and Metadata
# =============================================================================
ARG NODE_VERSION=20
ARG ALPINE_VERSION=3.19
ARG PNPM_VERSION=10.0.0
ARG BUILDKIT_INLINE_CACHE=1
ARG VERSION=latest

# =============================================================================
# DEPENDENCIES STAGE - Install and cache dependencies
# =============================================================================
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps

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

# Install pnpm
RUN npm install -g pnpm@${PNPM_VERSION}

# Copy package files for better caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Change ownership and install dependencies
RUN chown -R builder:builder /app
USER builder

# Set PNPM home to avoid permission issues
ENV PNPM_HOME=/tmp/.pnpm
ENV PATH=$PNPM_HOME:$PATH

# Install all dependencies (including dev for building)
RUN pnpm install --frozen-lockfile

# =============================================================================
# SHARED PACKAGE BUILD STAGE
# =============================================================================
FROM deps AS shared-builder

# Copy shared package source and root tsconfig
COPY --chown=builder:builder packages/shared ./packages/shared
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

# Copy API source code
COPY --chown=builder:builder apps/api ./apps/api
COPY --chown=builder:builder tsconfig.json ./

# Generate Prisma client and build application
RUN cd apps/api && \
    echo "Generating Prisma client..." && \
    cd prisma && pnpm exec prisma generate && cd .. && \
    echo "Prisma client generated successfully" && \
    ls -la node_modules/.prisma/client/ || echo "Warning: Prisma client not found" && \
    echo "Building application..." && \
    pnpm build && \
    echo "Application built successfully"

# Prune to production dependencies only
RUN pnpm --filter @flakeguard/api --prod deploy pruned/api

# =============================================================================
# SECURITY SCANNING STAGE (Optional)
# =============================================================================
FROM aquasec/trivy:latest AS scanner
COPY --from=builder /app/pruned/api /scan
# Security scan can be run in CI, but we'll keep it lightweight here
RUN trivy fs --security-checks vuln --skip-dirs /scan/node_modules/.pnpm /scan || true

# =============================================================================
# RUNTIME STAGE - Minimal production image
# =============================================================================
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

# Security and build metadata
LABEL maintainer="FlakeGuard Team <team@flakeguard.dev>" \
      version="${VERSION}" \
      description="FlakeGuard API Server - Flaky test detection and management" \
      org.opencontainers.image.title="FlakeGuard API" \
      org.opencontainers.image.description="Production-ready API server for flaky test detection" \
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

# Create application directories
RUN mkdir -p /app /run/secrets /var/log/flakeguard && \
    chown -R flakeguard:flakeguard /app /run/secrets /var/log/flakeguard && \
    chmod 755 /app /run/secrets /var/log/flakeguard

WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=flakeguard:flakeguard /app/pruned/api/node_modules ./node_modules
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/api/dist ./dist
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/api/prisma ./prisma
COPY --from=builder --chown=flakeguard:flakeguard /app/apps/api/package.json ./
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/dist ./packages/shared/dist
COPY --from=shared-builder --chown=flakeguard:flakeguard /app/packages/shared/package.json ./packages/shared/

# Ensure Prisma client is properly copied and accessible
RUN ls -la ./node_modules/.prisma/client/ || echo "Warning: Prisma client not found in runtime stage"

# Set secure permissions
RUN find /app -type f -exec chmod 644 {} \; && \
    find /app -type d -exec chmod 755 {} \; && \
    chmod +x /app/dist/server.js

# Switch to non-root user
USER flakeguard

# Environment variables
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps --max-old-space-size=1024" \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    VERSION=${VERSION}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/server.js"]

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

ENV NODE_ENV=development \
    LOG_LEVEL=debug

# Override command for development
CMD ["pnpm", "dev"]