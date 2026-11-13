# Application web AtouVent : construite avec Node, servie par nginx (fichiers statiques + relais /api vers l'API).
# Publiée dans GitHub Packages : ghcr.io/bricebokatola/atouvent-web
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/BriceBOKATOLA/atouvent" \
      org.opencontainers.image.description="AtouVent : application web (PWA) mobilités et climat en Île-de-France" \
      org.opencontainers.image.licenses="MIT"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
