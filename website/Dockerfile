# Atmosphere corporate site — static pages served by nginx.
#
# Build from the **repo root** (so this is not excluded by a website/ context):
#   docker build -f website/Dockerfile -t atmosphere-website .
#
# Railway must probe GET / (or /health), never /api/health. This image is
# not the Work Verification API. A service that inherits `node dist/index.js`
# fails the deploy probe and never listens on PORT.

FROM nginx:1.27-alpine AS runtime

ENV PORT=8080
ENV API_UPSTREAM=https://atmosphere-production.up.railway.app
ENV APP_ORIGIN=https://atmosphere-web-production.up.railway.app
ENV SITE_ORIGIN=https://atmosphere-website-production.up.railway.app
ENV NGINX_ENVSUBST_FILTER=PORT|API_UPSTREAM

COPY website/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY website /usr/share/nginx/html
RUN rm -rf /usr/share/nginx/html/nginx /usr/share/nginx/html/Dockerfile \
      /usr/share/nginx/html/railway.toml /usr/share/nginx/html/README.md \
      /usr/share/nginx/html/build-preview.py /usr/share/nginx/html/.vite \
      /usr/share/nginx/html/scripts \
  && find /usr/share/nginx/html -name '*.html' -exec \
      sed -i "s|<html lang=\"en\">|<html lang=\"en\" data-app-origin=\"${APP_ORIGIN}\">|" {} + \
  && sed -i "s|https://REPLACE-WITH-YOUR-DOMAIN|${SITE_ORIGIN}|g" \
      /usr/share/nginx/html/sitemap.xml /usr/share/nginx/html/robots.txt

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:$$PORT/health >/dev/null || exit 1

# Use the nginx image entrypoint so ${PORT} is substituted. Do not start Node.
CMD ["nginx", "-g", "daemon off;"]
