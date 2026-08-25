# Leftover Railway "Field Capture" service — static capture app + nginx probe.
#
# Build from the repo root (same as website/ and frontend/):
#   docker build -f fieldcapture/Dockerfile -t atmosphere-fieldcapture .
#
# Railway: Config File = /fieldcapture/railway.toml, Root Directory = /.
# The product capture URL remains the office app at /fieldcapture/.

FROM nginx:1.27-alpine AS runtime

ENV PORT=8080
ENV NGINX_ENVSUBST_FILTER=^PORT$$

COPY fieldcapture/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY fieldcapture/nginx/15-validate-fieldcapture-env.envsh /docker-entrypoint.d/15-validate-fieldcapture-env.envsh

WORKDIR /tmp/fieldcapture-src
COPY fieldcapture/index.html fieldcapture/manifest.webmanifest ./
COPY fieldcapture/js ./js
COPY fieldcapture/icons ./icons
RUN mkdir -p /usr/share/nginx/html/fieldcapture \
  && cp -a /tmp/fieldcapture-src/. /usr/share/nginx/html/ \
  && cp -a /tmp/fieldcapture-src/. /usr/share/nginx/html/fieldcapture/ \
  && rm -rf /tmp/fieldcapture-src \
  && rm -f /etc/nginx/conf.d/default.conf \
  && chmod +x /docker-entrypoint.d/15-validate-fieldcapture-env.envsh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
