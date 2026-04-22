# syntax=docker/dockerfile:1.6
#
# Nsaq Web — production image (Next.js 15 standalone)
# Build context: repo root
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://... -t nsaq-web:latest .

# ─── Stage 1: deps ───────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# ─── Stage 2: builder ────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/package-lock.json ./
COPY --from=deps /app/apps/api/package.json ./apps/api/
COPY --from=deps /app/apps/web/package.json ./apps/web/

ARG NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/web ./apps/web

WORKDIR /app/apps/web
RUN npm run build

# ─── Stage 3: runtime ────────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd -r nsaq && useradd -r -g nsaq -m -d /home/nsaq nsaq

COPY --from=builder --chown=nsaq:nsaq /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nsaq:nsaq /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nsaq:nsaq /app/apps/web/public ./apps/web/public

USER nsaq

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
