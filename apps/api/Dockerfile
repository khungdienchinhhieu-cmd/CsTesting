FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY data ./data
COPY tools ./tools
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tactical/shared build && pnpm --filter @tactical/api build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
