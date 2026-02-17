FROM node:22-slim

# Build tools needed for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer cache)
COPY package*.json ./
RUN npm ci --include=dev

# Rebuild native modules for this platform
RUN npm rebuild better-sqlite3

# Copy source
COPY src/ ./src/

# Data directory for SQLite (mount a Railway Volume here)
RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "src/index.js"]
