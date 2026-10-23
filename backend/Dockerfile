FROM node:20-alpine

# Create non-root user (use 1001 to avoid GID conflict)
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Ensure uploads dir is writable by non-root
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]

