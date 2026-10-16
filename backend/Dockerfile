FROM node:20-alpine

# Create non-root user
RUN addgroup -g 1000 -S app && adduser -u 1000 -S app -G app

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Ensure uploads dir is writable by non-root
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
