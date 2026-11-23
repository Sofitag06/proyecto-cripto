FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY server.js cripto.js ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.js"]
