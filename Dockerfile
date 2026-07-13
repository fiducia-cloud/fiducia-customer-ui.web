# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:22.17.0-bookworm-slim AS build
WORKDIR /build/fiducia-customer-ui.web
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27.5-alpine
# Hardened server block: security headers (CSP, nosniff, frame-ancestors),
# no-stale caching for the deploy-swappable /config.js, SPA route fallback.
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=build /build/fiducia-customer-ui.web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
