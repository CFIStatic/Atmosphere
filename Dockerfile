# Railway default: build context is the repo root (Railpack cannot detect
# a Node app here — there is no package.json at ./). This file builds the
# Work Verification BFF from backend/.
#
#   docker build -t atmosphere-backend .
#
# Local compose still uses backend/Dockerfile with context ./backend.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV COMPUTER_USE_ENABLED=false
ENV BACKUP_ENABLED=false
ENV MEDIA_BACKEND=supabase
ENV ALLOW_MOCK_DRIVERS=true
ENV FRONTEND_ORIGIN=https://app.atmosphereteam.com
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
