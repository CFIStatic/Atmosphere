# Atmosphere Internal — Vite SPA + nginx, /api proxied to the BFF.
#
#   docker build -f internal/Dockerfile -t atmosphere-internal .
#
# Railway: Config File = /internal/railway.json (same settings as railway.toml)
#   API_UPSTREAM=http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}
# Never start `node dist/index.js` on this image (no Node in the runtime stage).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY internal/package.json internal/package-lock.json ./
RUN npm ci
COPY internal/ ./
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Never bake demo fixtures into the hosted image. The SPA always calls /api.
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY internal/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY internal/nginx/15-validate-internal-env.sh /docker-entrypoint.d/15-validate-internal-env.sh
RUN chmod +x /docker-entrypoint.d/15-validate-internal-env.sh
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$$
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1
# Use the nginx image entrypoint so ${PORT} is substituted. Do not start Node.
CMD ["nginx", "-g", "daemon off;"]
