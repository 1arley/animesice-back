#!/bin/sh
# Container entrypoint: aplica migrations pendentes, sobe Xvfb, inicia a API.
#
# Migration roda AQUI, dentro da imagem, e não no `command` do compose. Um
# `docker-compose.override.yml` que sobrescreve `command` sem `migrate deploy`
# deixa o Prisma cliente SELECTar colunas que o banco não tem -> HTTP 500 em
# toda rota que toca a tabela, sem erro visível no boot. Dentro da imagem não
# existe override que pule esse passo.
#
# `&&` proposital: banco desatualizado derruba a API em vez de servir 500.
# Para ignorar de proposito (restore de dump, bootstrap), defina SKIP_MIGRATE=1.
set -e

PRISMA=/app/node_modules/.bin/prisma

if [ -z "$DATABASE_URL" ]; then
  echo "entrypoint: DATABASE_URL ausente" >&2
  exit 1
fi

if [ "$SKIP_MIGRATE" = "1" ]; then
  echo "entrypoint: SKIP_MIGRATE=1, pulando prisma migrate deploy"
else
  if [ ! -x "$PRISMA" ]; then
    echo "entrypoint: Prisma CLI ausente em $PRISMA (imagem corrompida?)" >&2
    exit 1
  fi
  echo "entrypoint: aplicando migrations pendentes"
  "$PRISMA" migrate deploy
fi

# Xvfb: o player do Blogger (blogger.com/video.g?token=...) só renderiza
# <video> e gera googlevideo.com/videoplayback com headless:false — precisa de X.
echo "entrypoint: iniciando Xvfb :99"
/usr/bin/Xvfb :99 -screen 0 1366x768x24 &
export DISPLAY=:99
sleep 1

echo "entrypoint: iniciando API"
exec node dist/main.js