# Atmosphere BFF — production image for the Work Verification path.
# Build from repo root:
#   docker build -f backend/Dockerfile -t atmosphere-backend ./backend
#
# Required at runtime: NODE_ENV=production, FRONTEND_ORIGIN, SUPABASE_*,
# DEVICE_PEPPER, CONTACT_TO_EMAIL, CAREERS_TO_EMAIL, and usually SMTP_*.
# See docs/production.md and backend/.env.example.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=::
ENV COMPUTER_USE_ENABLED=false
ENV BACKUP_ENABLED=false
ENV FRONTEND_ORIGIN=https://app.atmosphereteam.com
# ffmpeg is optional but required for proof sparse-frame extraction.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 999 --create-home --shell /usr/sbin/nologin atmosphere
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
USER atmosphere
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
