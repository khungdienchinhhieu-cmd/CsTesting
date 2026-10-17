FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/gameserver ./apps/gameserver
COPY data ./data
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tactical/shared build && pnpm --filter @tactical/bots build && pnpm --filter @tactical/gameserver build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 8443
CMD ["node", "apps/gameserver/dist/index.js"]
