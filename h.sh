#!/usr/bin/env bash
set -e
cd ~/proyecto-cripto/vulnerable/contracts
[ -f package.json ] || npm init -y
npm install --save-dev hardhat@^2.22 @nomicfoundation/hardhat-toolbox@hh2
cat > hardhat.config.js << 'CFG'
require("@nomicfoundation/hardhat-toolbox");
module.exports = {
  solidity: "0.8.28",
  networks: { localhost: { url: "http://127.0.0.1:8545" } }
};
CFG
npx hardhat compile
