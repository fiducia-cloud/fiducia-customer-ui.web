# syntax=docker/dockerfile:1
# Static Vite customer portal image.
FROM node:24-slim AS build
WORKDIR /build/fiducia-customer-ui.web
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /build/fiducia-customer-ui.web/dist /usr/share/nginx/html
EXPOSE 80
