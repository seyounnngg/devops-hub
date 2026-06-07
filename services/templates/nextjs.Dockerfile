# General-purpose Dockerfile for Next.js
# Designed to work for most student / typical projects (even without standalone)
# Updated for Next.js 15/16 compatibility (sharp native module support in Alpine)

FROM node:20-alpine

# Install compatibility libs required by sharp (used by Next.js for image optimization)
# This fixes common "npm run build" failures in Alpine for modern create-next-app projects
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1

# Copy package files first (better layer caching)
COPY package*.json ./

# Install ALL dependencies (prod + dev) because modern Next.js (16+) build
# requires devDependencies like @tailwindcss/postcss for Tailwind v4 + Turbopack.
# (We avoid setting NODE_ENV=production here so devDeps are installed for build)
RUN npm ci || npm install

# Copy the rest of the application
COPY . .

# Build the Next.js application
RUN npm run build

# Set production mode for runtime
ENV NODE_ENV=production

# Expose Next.js default port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]