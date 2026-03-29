FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# 백엔드 포트 (보통 3000 또는 3001)
EXPOSE 3000

CMD ["npm", "start"]
