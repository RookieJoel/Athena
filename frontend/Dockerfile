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

#stage 3 ; production image
FROM node:26-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production

RUN apk upgrade --no-cache && apk add --no-cache curl && addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static


EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD [ "curl", "-f", "http://localhost:3000/health" ]
    
CMD ["node", "server.js"]
