FROM node:18-alpine

RUN apk add --no-cache git docker-cli findutils

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
