#!/usr/bin/env bash
set -u

shard="${1:-}"
if [[ ! "$shard" =~ ^([0-9]+)/([1-9][0-9]*)$ ]] || (( BASH_REMATCH[1] >= BASH_REMATCH[2] || BASH_REMATCH[2] > 4 )); then
  echo 'Uso: run-overnight-episode-source-backfill.sh N/TOTAL (TOTAL até 4)' >&2
  exit 64
fi

lock="/tmp/animesice-source-backfill-${shard//\//-}.lock"
exec 9>"$lock"
if ! flock -n 9; then
  echo "Worker $shard já está em execução" >&2
  exit 75
fi

while true; do
  node "$(dirname "$0")/overnight-episode-source-backfill.mjs" --apply --shard "$shard"
  status=$?
  if (( status == 0 )); then
    exit 0
  fi
  echo "Worker $shard terminou com código $status; retomando pelo checkpoint em 30s" >&2
  sleep 30
done
