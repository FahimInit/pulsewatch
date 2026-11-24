FROM node:24-alpine AS builder
WORKDIR /app

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_SOCKET_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY worker/package.json ./worker/
COPY client/package.json ./client/
COPY prisma ./prisma

RUN npm ci

COPY shared ./shared
COPY client ./client

RUN npm run build -w @pulsewatch/shared && \
    npm run build -w @pulsewatch/client

FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/client/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
