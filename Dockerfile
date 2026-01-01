FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

# Ставим build-инструменты и sqlite
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 make g++ sqlite3 libsqlite3-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev \
  && npm rebuild sqlite3 --build-from-source \
  && npm cache clean --force

COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
