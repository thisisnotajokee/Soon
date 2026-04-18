FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

EXPOSE 3100

CMD ["bash", "-lc", "node packages/api/scripts/run-migrations.mjs && node packages/api/src/runtime/server.mjs"]
