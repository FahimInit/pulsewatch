FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY worker/package.json ./worker/
COPY client/package.json ./client/
COPY prisma ./prisma

RUN npm ci

COPY shared ./shared
COPY server ./server

RUN npm run db:generate && \
    npm run build -w @pulsewatch/shared && \
    npm run build -w @pulsewatch/server

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/shared/package.json ./shared/package.json
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist

EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node server/dist/index.js"]
