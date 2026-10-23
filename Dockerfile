# syntax=docker/dockerfile:1.7
#
# Production images for Tartly (SKILL §15.1).
#
#   docker build --target runner -t tartly-web .
#   docker run -p 3000:3000 --env-file .env tartly-web
#
#   docker build --target worker -t tartly-worker .
#   docker run --env-file .env tartly-worker
#
# The `runner` target is a tiny, non-root image built from Next's traced
# `standalone` output. The `worker` target runs the long-lived durable-queue
# worker (Phase D1) and therefore keeps the source + dev tooling it needs.
#
# Pin the base image by digest in CI for reproducible builds; the version tag
# below is the human-readable default.

ARG NODE_VERSION=22-bookworm-slim

# --- Stage 1: dependencies -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: build --------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# `next build` evaluates server modules, so `lib/env.ts` needs the required
# (non-secret) variables present. Real secrets are injected at runtime. Every
# `NEXT_PUBLIC_*` value is inlined into the client bundle, so it must be passed
# as a build arg — setting it only at runtime is too late.
ARG NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
ARG NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=""
ARG NEXT_PUBLIC_CAL_BOOKING_LINK=""
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=""
ARG NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED=""
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-000000 \
    BETTER_AUTH_URL=http://localhost:3000 \
    NEXT_PUBLIC_BETTER_AUTH_URL=${NEXT_PUBLIC_BETTER_AUTH_URL} \
    NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=${NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT} \
    NEXT_PUBLIC_CAL_BOOKING_LINK=${NEXT_PUBLIC_CAL_BOOKING_LINK} \
    NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION} \
    NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED=${NEXT_PUBLIC_MICROSOFT_CONNECT_ENABLED} \
    GOOGLE_CLIENT_ID=build-time-placeholder \
    GOOGLE_CLIENT_SECRET=build-time-placeholder \
    UPSTASH_REDIS_REST_URL=https://upstash.invalid \
    UPSTASH_REDIS_REST_TOKEN=build-time-placeholder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage 3: web runtime (minimal, non-root) ------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone trace plus the assets it does not copy by itself.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Liveness only: a Redis/Postgres blip must not make the orchestrator kill a
# healthy container (readiness is /api/health/ready, checked by the LB).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# --- Stage 4: dedicated queue worker (Phase D1) ----------------------------
FROM deps AS worker
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
USER node
# Traps SIGTERM/SIGINT, drains in-flight work, then closes the pool (Phase D2).
CMD ["npm", "run", "worker"]
