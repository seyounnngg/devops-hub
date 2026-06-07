# Generic Node.js backend (Express, etc.)
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production || npm install --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]