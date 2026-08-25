# Atmosphere Field Capture — static phone app + nginx, /api proxied to the BFF.
#
# Build from the **repo root**:
#   docker build -f fieldcapture/Dockerfile -t atmosphere-field .
#
# Railway: Config File = /fieldcapture/railway.json
#   API_UPSTREAM=http://${{ "Atmosphere APIs".RAILWAY_PRIVATE_DOMAIN }}:${{ "Atmosphere APIs".PORT }}
# Never start `node dist/index.js` on this image (no Node in the runtime).

FROM nginx:1.27-alpine AS runtime

COPY fieldcapture/index.html fieldcapture/manifest.webmanifest /usr/share/nginx/html/
COPY fieldcapture/js /usr/share/nginx/html/js
COPY fieldcapture/icons /usr/share/nginx/html/icons
# Same files at /fieldcapture/ so office invite paths keep working on this host.
RUN mkdir -p /usr/share/nginx/html/fieldcapture \
 && cp /usr/share/nginx/html/index.html /usr/share/nginx/html/manifest.webmanifest \
      /usr/share/nginx/html/fieldcapture/ \
 && cp -a /usr/share/nginx/html/js /usr/share/nginx/html/fieldcapture/ \
 && cp -a /usr/share/nginx/html/icons /usr/share/nginx/html/fieldcapture/ \
 && rm -f /usr/share/nginx/html/js/capture-core.test.html \
          /usr/share/nginx/html/fieldcapture/js/capture-core.test.html \
 && rm -f /etc/nginx/conf.d/default.conf

COPY fieldcapture/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY fieldcapture/nginx/field-start.sh /usr/local/bin/field-start.sh
COPY fieldcapture/nginx/15-validate-field-env.envsh /docker-entrypoint.d/15-validate-field-env.envsh
RUN chmod +x /usr/local/bin/field-start.sh /docker-entrypoint.d/15-validate-field-env.envsh

# Only substitute these; otherwise envsubst would empty nginx's $uri / $host.
ENV NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM|API_RESOLVERS)$$
ENV PORT=80
ENV API_UPSTREAM=http://127.0.0.1:4000
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
