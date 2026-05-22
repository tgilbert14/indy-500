# Official Playwright image: Chromium + all OS deps already installed.
# This is what makes the headless scraper work reliably on Azure.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
# Browsers are already in the base image, so skip the postinstall download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
