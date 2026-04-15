FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./

# Sharp needs the correct native binary for linux/x64
RUN npm ci --omit=dev

COPY . .

EXPOSE 5000
CMD ["node", "server.js"]
