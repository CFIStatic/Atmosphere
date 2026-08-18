# Atmosphere office console — Vite SPA + Verifier + Field Capture, served by nginx.
#
# Build from the **repo root** (needs sibling verifier/ and fieldcapture/):
#   docker build -f frontend/Dockerfile -t atmosphere-frontend .
#
# Leave VITE_API_BASE_URL empty in production. The browser calls same-origin
# /api/… and nginx proxies to the Work Verification BFF (API_UPSTREAM).

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
WORKDIR /src/frontend
RUN npm ci
WORKDIR /src
COPY frontend ./frontend
COPY verifier ./verifier
COPY fieldcapture ./fieldcapture
WORKDIR /src/frontend
# Same-origin /api in the browser. Do not bake a cross-origin API URL here.
ARG VITE_API_BASE_URL=
ARG VITE_BACKEND_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
ENV PORT=8080
ENV API_UPSTREAM=https://atmosphere-production.up.railway.app
ENV NGINX_ENVSUBST_FILTER=PORT|API_UPSTREAM
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/ >/dev/null || exit 1
