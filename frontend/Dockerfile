FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
# Ignore lifecycle scripts here — vendor script is only present after full COPY.
RUN npm ci --ignore-scripts

FROM node:22-alpine AS builder

WORKDIR /app

# Empty = same-origin (Traefik reverse proxy). For direct API access set build args.
ARG NEXT_PUBLIC_API_URL=
ARG NEXT_PUBLIC_WS_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Vendor Apple emoji PNGs into public/ (external CDNs are often blocked).
RUN node scripts/vendor-apple-emoji.mjs && npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=app:app /app/node_modules ./node_modules

# Public assets are required at runtime for /logo.png and for the
# /_next/image optimizer's internal fetch of local paths.
# next.config.mjs is required at runtime so images.contentDispositionType
# and other config overrides are applied (not only baked into manifests).
USER app

EXPOSE 3000

CMD ["npm", "run", "start"]
