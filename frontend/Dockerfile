# Atmosphere office app — Vite console + Verifier + Field Capture, nginx.
#
# Build from the **repo root** so sibling static apps are in the context:
#   docker build -f frontend/Dockerfile -t atmosphere-app .
#
# The browser talks to this origin only. /api is reverse-proxied at runtime
# to API_UPSTREAM (the Work Verification BFF). Leave VITE_API_BASE_URL empty
# so the SPA uses same-origin /api and httpOnly cookies just work.
#
# Railway: service Config File = /frontend/railway.toml
#   API_UPSTREAM=http://${{backend.RAILWAY_PRIVATE_DOMAIN}}:${{backend.PORT}}

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY verifier /verifier
COPY fieldcapture /fieldcapture
ARG VITE_API_BASE_URL=
ARG VITE_BACKEND_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Only substitute these; otherwise envsubst would empty nginx's $uri / $host.
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$$
ENV PORT=80
ENV API_UPSTREAM=http://127.0.0.1:4000
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1
