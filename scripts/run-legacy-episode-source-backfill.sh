#!/usr/bin/env bash
set -u

shard="${1:-}"
if [[ ! "$shard" =~ ^([0-9]+)/([1-9][0-9]*)$ ]] || (( BASH_REMATCH[1] >= BASH_REMATCH[2] || BASH_REMATCH[2] > 4 )); then
  echo 'Uso: run-legacy-episode-source-backfill.sh N/TOTAL (TOTAL até 4)' >&2
  exit 64
fi

lock="/tmp/animesice-legacy-source-backfill-${shard//\//-}.lock"
exec 9>"$lock"
if ! flock -n 9; then
  echo "Worker $shard já está em execução" >&2
  exit 75
fi

failures=0
while true; do
  node "$(dirname "$0")/backfill-legacy-episode-sources.mjs" --apply --shard "$shard"
  status=$?
  if (( status == 0 )); then
    exit 0
  fi
  failures=$((failures + 1))
  delay=$((30 * (2 ** (failures > 4 ? 4 : failures - 1))))
  (( delay > 300 )) && delay=300
  echo "Worker $shard terminou com código $status; checkpoint salvo, nova tentativa em ${delay}s" >&2
  sleep "$delay"
done
