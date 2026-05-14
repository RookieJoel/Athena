# syntax=docker/dockerfile:1

#stage 1 ; install dependency
FROM node:26-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

#stage 2 ; build
FROM node:26-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

#stage 3 ; install production dependency
FROM node:26-alpine AS prod-deps
WORKDIR /app 
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

#stage 4 ; production image
FROM node:26-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache curl && addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD [ "curl", "-f", "http://localhost:4000/health" ]

CMD ["node", "dist/server.js"]
