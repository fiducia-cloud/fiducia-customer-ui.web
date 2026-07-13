# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:26.5.0-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS build
WORKDIR /build/fiducia-customer-ui.web
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.2-alpine@sha256:6320020c7da8714feab524e02c08c5a1958675c4e68700e93a2fd8970b065786
# Hardened server block: security headers (CSP, nosniff, frame-ancestors),
# no-stale caching for the deploy-swappable /config.js, SPA route fallback.
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=build /build/fiducia-customer-ui.web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
