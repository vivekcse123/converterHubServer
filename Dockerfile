FROM node:20-alpine AS build

# Install system dependencies for pdf2pic (ghostscript), sharp, and canvas
RUN apk add --no-cache \
    ghostscript \
    imagemagick \
    imagemagick-pdf \
    fontconfig \
    ttf-freefont \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    libjpeg-turbo-dev \
    giflib-dev \
    pixman-dev \
    pkgconf

WORKDIR /app
COPY package*.json ./

# Install all dependencies (including native modules for Sharp, canvas, etc.)
RUN npm ci --omit=dev

COPY . .

# Create required directories with proper permissions
RUN mkdir -p uploads outputs logs uploads/temp .tessdata && \
    chmod -R 755 uploads outputs logs

EXPOSE 3000
CMD ["node", "server.js"]
