# Generic Web App (for projects with package.json + build script)
# This is a safe fallback for many typical student projects.
# Prefers serving static files with SPA support when a build output exists.

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .

RUN npm run build || echo "Build step completed or skipped"

# Production stage
FROM nginx:alpine

# Copy possible build outputs (dist or build)
COPY --from=builder /app/dist /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true

# Fallback: copy everything if no dist/build (for very simple static cases)
COPY --from=builder /app /usr/share/nginx/html

# Strong SPA routing support
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]