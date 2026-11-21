FROM node:22-alpine
WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN npm install --workspace=shared --workspace=server

COPY shared ./shared
COPY server ./server

EXPOSE 3090
CMD ["npx", "tsx", "server/src/index.ts"]
