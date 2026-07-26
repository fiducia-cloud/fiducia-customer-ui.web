# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:26.5.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build
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
