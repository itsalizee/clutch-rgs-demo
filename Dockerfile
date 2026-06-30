# Clutch Studios — hosted RGS demo (both games, one port).
# Builds a single web service that serves the static clients AND both
# WebSocket game servers on $PORT. The Ascent crash client in public/ascent
# is a prebuilt static bundle (no build step needed here).
FROM node:22-slim
WORKDIR /app

# Install deps first for layer caching. tsx (a devDependency) runs the server,
# so install everything — do NOT use --production.
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
# Render/Railway/Fly inject $PORT; hosted.ts reads it (defaults to 8080).
EXPOSE 8080
CMD ["npm", "run", "start:hosted"]
