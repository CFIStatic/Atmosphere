# Atmosphere corporate site — static pages served by nginx.
#
# Build from the **repo root** (so this is not excluded by a website/ context):
#   docker build -f website/Dockerfile -t atmosphere-website .
#
# Railway must probe GET /health (or /api/health), never a proxied BFF path.
# This image is not the Work Verification API. A service that inherits
# `node dist/index.js` fails the deploy probe and never listens on PORT.

FROM nginx:1.27-alpine AS runtime

ENV PORT=8080
# Local default only. On Railway this is the BFF's private domain (api.upstream,
# set by .github/workflows/deploy-website.yml). Never fall back to the public
# https host: that hairpins /api out of the mesh and 502s the site's forms.
ENV API_UPSTREAM=http://127.0.0.1:4000
ENV APP_ORIGIN=https://atmosphere-web-production.up.railway.app
# Live Corporate Website hostname (Settings → Networking). The
# atmosphere-website-production.up.railway.app name was never generated.
ENV SITE_ORIGIN=https://website-production-7e3f.up.railway.app
# Only substitute our knobs. Unanchored PORT matched Railway vars like RAILWAY_*PORT*.
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$

COPY website/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY website/nginx/website-start.sh /usr/local/bin/website-start.sh
# Normalises PORT / API_UPSTREAM before envsubst, on both boot paths. Runs
# before 20-envsubst-on-templates.sh; see the script for why nginx must never
# be handed an upstream Railway resolved to "http://:".
COPY website/nginx/15-validate-website-env.envsh /docker-entrypoint.d/15-validate-website-env.envsh
COPY website /usr/share/nginx/html
RUN rm -rf /usr/share/nginx/html/nginx /usr/share/nginx/html/Dockerfile \
      /usr/share/nginx/html/railway.toml /usr/share/nginx/html/README.md \
      /usr/share/nginx/html/build-preview.py /usr/share/nginx/html/.vite \
      /usr/share/nginx/html/scripts \
  && rm -f /etc/nginx/conf.d/default.conf \
  && chmod +x /usr/local/bin/website-start.sh /docker-entrypoint.d/15-validate-website-env.envsh \
  && find /usr/share/nginx/html -name '*.html' -exec \
      sed -i "s|<html lang=\"en\">|<html lang=\"en\" data-app-origin=\"${APP_ORIGIN}\">|" {} + \
  && sed -i "s|https://REPLACE-WITH-YOUR-DOMAIN|${SITE_ORIGIN}|g" \
      /usr/share/nginx/html/sitemap.xml /usr/share/nginx/html/robots.txt

EXPOSE 8080
# Docker HEALTHCHECK is exec-form — expand PORT at build time (8080). Railway
# uses its own GET /health probe against $PORT, not this instruction.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

# Official nginx entrypoint (envsubst + IPv6). website-start.sh is kept as the
# Railway startCommand so a leftover `node dist/index.js` cannot take over.
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
