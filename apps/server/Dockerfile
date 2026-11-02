FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY db/package.json db/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @genui-erp/server...
COPY db db
COPY apps/server apps/server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "pnpm run db:setup && pnpm start"]
