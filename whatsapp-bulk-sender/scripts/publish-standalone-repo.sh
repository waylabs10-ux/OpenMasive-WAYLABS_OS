#!/usr/bin/env bash
# Publica este proyecto como repositorio independiente en GitHub.
# Uso: ./scripts/publish-standalone-repo.sh [URL-del-repo]
set -euo pipefail

REPO_URL="${1:-https://github.com/waylabs10-ux/whatsapp-bulk-sender.git}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "→ Preparando copia limpia en ${WORK_DIR}"
tar \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=sessions \
  --exclude=.env \
  --exclude=data/sent.db \
  --exclude=.git \
  -cf - -C "${ROOT_DIR}" . | tar -xf - -C "${WORK_DIR}"

cd "${WORK_DIR}"
rm -rf .git

git init
git checkout -B main
git add .
git commit -m "feat: WAYLABS OS WhatsApp Bulk Sender — initial release"

BRANCH="$(git branch --show-current)"
if [[ "${BRANCH}" != "main" ]]; then
  git branch -M main
fi

echo "→ Subiendo a ${REPO_URL}"
echo "  (El repositorio debe existir vacío en GitHub antes de ejecutar esto)"
git remote add origin "${REPO_URL}"
git push -u origin main

echo "✅ Repositorio publicado: ${REPO_URL}"
