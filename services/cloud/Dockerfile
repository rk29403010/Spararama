FROM node:22-slim AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY server ./server
COPY src ./src
COPY services/cloud ./services/cloud
RUN pnpm cloud:build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --from=build /app/build/cloud/cloud-server.cjs ./build/cloud/cloud-server.cjs
COPY --from=build /app/build/cloud/cloud-server.cjs.map ./build/cloud/cloud-server.cjs.map

EXPOSE 8080
CMD ["node", "build/cloud/cloud-server.cjs"]
