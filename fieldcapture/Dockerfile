# Field Capture web host — static capture app + /api proxy to the BFF.
#
# Build from the repo root (same as website/ and frontend/):
#   docker build -f fieldcapture/Dockerfile -t atmosphere-fieldcapture .
#
# Railway: Config File = /fieldcapture/railway.toml, Root Directory = /.
# Live URL: https://app.atmosphereteam.com/
# Office /fieldcapture/ remains as a same-origin fallback.

FROM mirror.gcr.io/library/nginx:1.27-alpine AS runtime

ENV PORT=8080
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$
ENV API_UPSTREAM=https://atmosphere-production.up.railway.app

COPY fieldcapture/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY fieldcapture/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY fieldcapture/nginx/15-validate-fieldcapture-env.envsh /docker-entrypoint.d/15-validate-fieldcapture-env.envsh

WORKDIR /tmp/fieldcapture-src
COPY fieldcapture/index.html fieldcapture/manifest.webmanifest ./
COPY fieldcapture/js ./js
COPY fieldcapture/icons ./icons
# Stamp each script tag with its content hash so nginx can cache js/ for a
# year (versioned URL changes whenever the file does).
RUN for f in js/*.js; do \
      n=$(basename "$f"); h=$(sha256sum "$f" | cut -c1-12); \
      sed -i "s#js/${n}?v=[^\"]*\"#js/${n}?v=${h}\"#g" index.html; \
    done \
  && grep -q 'js/app.js?v=' index.html
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
