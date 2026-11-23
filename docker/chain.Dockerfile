# Nodo Hardhat + despliegue del contrato. STACK = vulnerable | mitigada
FROM node:22-slim
ARG STACK
ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true
WORKDIR /app
COPY ${STACK}/contracts/package.json ./
RUN npm install --no-audit --no-fund
COPY ${STACK}/contracts/hardhat.config.js ./
COPY ${STACK}/contracts/contracts ./contracts
COPY ataques/contracts/Atacante.sol ./contracts/Atacante.sol
COPY ${STACK}/contracts/scripts ./scripts
COPY ${STACK}/contracts/test ./test
RUN npx hardhat compile
COPY docker/start-chain.sh /start-chain.sh
EXPOSE 8545
CMD ["sh", "/start-chain.sh"]
