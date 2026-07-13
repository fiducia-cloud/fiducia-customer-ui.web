# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:22.17.0-bookworm-slim@sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0 AS build
WORKDIR /build/fiducia-customer-ui.web
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27.5-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0
# Hardened server block: security headers (CSP, nosniff, frame-ancestors),
# no-stale caching for the deploy-swappable /config.js, SPA route fallback.
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=build /build/fiducia-customer-ui.web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
