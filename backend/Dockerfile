# syntax=docker/dockerfile:1

#stage 1 ; install dependency
FROM node:26-alpine as deps

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

#stage 2 ; build
FROM node:26-alpine as build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

#stage 3 ; install production dependency
FROM node:26-alpine as prod-deps
WORKDIR /app 
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

#stage 4 ; production image
FROM node:26-alpine as prod
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
