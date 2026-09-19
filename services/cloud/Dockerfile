FROM node:22-slim AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY server ./server
COPY services/cloud ./services/cloud
RUN pnpm cloud:build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist/cloud-server.cjs ./dist/cloud-server.cjs
COPY --from=build /app/dist/cloud-server.cjs.map ./dist/cloud-server.cjs.map

EXPOSE 8080
CMD ["node", "dist/cloud-server.cjs"]
