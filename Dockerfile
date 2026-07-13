# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:24-slim AS build
WORKDIR /build/fiducia-customer-ui.web
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Hardened server block: security headers (CSP, nosniff, frame-ancestors),
# no-stale caching for the deploy-swappable /config.js, SPA route fallback.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/fiducia-customer-ui.web/dist /usr/share/nginx/html
EXPOSE 80
