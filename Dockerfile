FROM node:20-alpine AS build

# System deps for canvas/sharp/pdf2pic + Chromium for Puppeteer.
# Alpine uses musl libc so we must use the distro Chromium (not Puppeteer's bundled glibc Chrome).
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
    pkgconf \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates

# Skip Puppeteer's bundled Chrome download; use the Alpine chromium package instead.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

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
