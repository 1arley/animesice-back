#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ssh_args=(-i "$HOME/.ssh/id_azure.pem" -o BatchMode=yes -o ConnectTimeout=12)
remote='iarley@65.52.197.161'
port=15440
report_path="$HOME/.cache/animesice/card-skin-seed-$(date -u +%Y%m%dT%H%M%SZ).tsv"
mkdir -p "$(dirname "$report_path")"

remote_database_url="$(ssh "${ssh_args[@]}" "$remote" 'docker exec animesice-back-app-1 printenv DATABASE_URL')"
mal_assignment="$(ssh "${ssh_args[@]}" "$remote" "grep -m1 -E '^[[:space:]]*MAL_CLIENT_ID[[:space:]]*=' /srv/stacks/animesice-back/.env || true")"
mal_client_id="$(MAL_ASSIGNMENT="$mal_assignment" node -e 'process.stdout.write(require("dotenv").parse(process.env.MAL_ASSIGNMENT || "").MAL_CLIENT_ID || "")')"
unset mal_assignment
[[ -n "$mal_client_id" ]] || { echo 'MAL_CLIENT_ID está vazio no .env da VPS' >&2; exit 78; }
database_ip="$(ssh "${ssh_args[@]}" "$remote" 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" animesice-back-db-1')"
[[ "$database_ip" =~ ^[0-9.]+$ ]] || { echo 'IP do banco remoto inválido' >&2; exit 1; }
database_url="$(REMOTE_DATABASE_URL="$remote_database_url" LOCAL_PORT="$port" node -e 'const url = new URL(process.env.REMOTE_DATABASE_URL); url.hostname = "127.0.0.1"; url.port = process.env.LOCAL_PORT; process.stdout.write(url.toString())')"
unset remote_database_url

tunnel_pid=''
cleanup() {
  if [[ -n "$tunnel_pid" ]]; then
    kill "$tunnel_pid" 2>/dev/null || true
    wait "$tunnel_pid" 2>/dev/null || true
    tunnel_pid=''
  fi
}
trap cleanup EXIT

while true; do
  ssh "${ssh_args[@]}" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=10 -N -L "127.0.0.1:${port}:${database_ip}:5432" "$remote" &
  tunnel_pid=$!

  ready=false
  for _ in {1..30}; do
    if ! kill -0 "$tunnel_pid" 2>/dev/null; then break; fi
    if DATABASE_URL="$database_url" node -e 'const { Pool } = require("pg"); const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 1000 }); pool.query("SELECT 1").then(() => process.exit(0)).catch(() => process.exit(1)).finally(() => pool.end())' >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    echo 'Aguardando o túnel SSH e o banco da VPS' >&2
    cleanup
    sleep 10
    continue
  fi

  set +e
  DATABASE_URL="$database_url" MAL_CLIENT_ID="$mal_client_id" \
    CARD_SKINS_REPORT="$report_path" \
    node_modules/.bin/ts-node scripts/seed-card-skins.ts "$@"
  exit_code=$?
  set -e
  cleanup
  if (( exit_code == 0 )); then exit 0; fi
  if (( exit_code != 75 )); then exit "$exit_code"; fi
  echo 'Falha transitória; retomando pelo estado atual do banco em 30s' >&2
  sleep 30
done
