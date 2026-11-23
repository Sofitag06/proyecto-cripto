#!/usr/bin/env bash
# Instala Docker + Docker Compose en Ubuntu (correr como usuario normal, pide sudo)
set -e
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git curl
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
echo ">> Docker instalado. Cierra sesión y vuelve a entrar (o reinicia) para usar docker sin sudo."
