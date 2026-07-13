# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:26.5.0-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS build
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
