# Simple static website (HTML, CSS, JS, images, etc.)
# Includes SPA routing support (for cases where a built React/Vite app is deployed as static)
FROM nginx:alpine

# Copy all files from the project root into nginx html folder
COPY . /usr/share/nginx/html

# Support SPA routing (React Router, Vue Router, etc.)
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