#!/usr/bin/env bash
# Local replica of .github/workflows/ci.yml (+ the npm audit job of
# security.yml). Same steps, same order, same flags — so a green run here
# means a green GitHub Actions run.
#
#   quality   lint + prettier --check + tsc --noEmit
#   unit      jest --coverage (coverageThreshold gates the job)
#   e2e       real Postgres (docker) + prisma migrate deploy + jest e2e
#   build     nest build (only if the three above passed, like `needs:`)
#   docker    docker build of the prod Dockerfile (only if build passed)
#   audit     npm audit --audit-level=high --omit=dev (never gates build)
#
# Usage: npm run ci:local [-- --fresh] [--keep-db] [--skip-docker]
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# --- flags -----------------------------------------------------------------
FRESH=0
KEEP_DB=0
SKIP_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;       # npm ci + prisma generate (validates the lockfile)
    --keep-db) KEEP_DB=1 ;;   # leave the Postgres container running afterwards
    --skip-docker) SKIP_DOCKER=1 ;;  # skip the image build (slow: chromium+Xvfb)
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'Unknown flag: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# --- output ----------------------------------------------------------------
if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; DIM=''; OFF=''
fi
BOLD=$'\033[1m'

LOG_DIR="$(mktemp -d -t ci-local.XXXXXX)"
trap 'rm -rf "$LOG_DIR"' EXIT

RESULTS=()
FAILED=0

# run_step <name> <command...> — silent unless it fails, then tail the log.
run_step() {
  local name=$1; shift
  local log="$LOG_DIR/$name.log"
  local start=$SECONDS

  # Progress marker only on a TTY — in a piped log it would just leave a
  # half-written line behind.
  [ -t 1 ] && printf '%s-> %s%s' "$DIM" "$name" "$OFF"
  local result
  if "$@" >"$log" 2>&1; then
    result="pass"; RESULTS+=("ok|$name|$((SECONDS - start))s|")
  else
    result="fail"; FAILED=1; RESULTS+=("fail|$name|$((SECONDS - start))s|")
  fi
  local colour="$GREEN"; [ "$result" = fail ] && colour="$RED"
  [ -t 1 ] && printf '\r\033[K'
  printf '%-14s %s%s%s %s(%ss)%s\n' "$name" "$colour" "$result" "$OFF" "$DIM" "$((SECONDS - start))" "$OFF"
  [ "$result" = fail ] && tail -n 40 "$log"
  return 0
}

# CI gates: exit non-zero on failure, same `if: success()` semantics.
ci() { "$@"; }

echo "${BOLD}local CI · animesice-back${OFF}"

# .nvmrc pins the Node version Actions installs; warn instead of failing so a
# dev on a nearby major still gets the useful signal.
want_major=$(tr -dc '0-9' <.nvmrc)
have_major=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
if [ "$want_major" != "$have_major" ]; then
  printf '%s! node %s local, CI usa %s%s\n' "$YELLOW" "$have_major" "$want_major" "$OFF"
fi

if [ "$FRESH" = 1 ]; then
  run_step install ci bash -c 'npm ci && npx prisma generate'
  [ "$FAILED" = 1 ] && { printf '\n%saborted%s\n' "$RED" "$OFF"; exit 1; }
elif [ ! -d node_modules ]; then
  printf '%s! node_modules ausente — rode com --fresh%s\n' "$YELLOW" "$OFF"
  exit 1
fi

# --- postgres (service container of the e2e job) ---------------------------
STARTED_DB=0
if docker ps -q -f name='^/animesice-db-test-postgres$' | grep -q .; then
  printf '%sreusing postgres container animesice-db-test-postgres%s\n' "$DIM" "$OFF"
else
  printf '%sstarting postgres:15 on :5433%s\n' "$DIM" "$OFF"
  docker compose -f docker-compose.test.yml up -d --wait --wait-timeout 60 || {
    printf '%sfailed to start postgres%s\n' "$RED" "$OFF"
    exit 1
  }
  STARTED_DB=1
fi

# --- phase 1: independent jobs (run all, like CI running them in parallel) ---
run_step quality ci bash -c '
  npm run lint &&
  npx prettier --check "src/**/*.ts" "test/**/*.ts" &&
  npx tsc --noEmit -p tsconfig.json'

run_step unit-tests ci bash -c '
  node node_modules/dotenv-cli/cli.js -e .env.test -- \
    npm run test:unit -- --coverage --detectOpenHandles --forceExit'

run_step e2e-tests ci bash -c '
  node node_modules/dotenv-cli/cli.js -e .env.test -- npx prisma migrate deploy &&
  NODE_OPTIONS=--experimental-vm-modules \
    node node_modules/dotenv-cli/cli.js -e .env.test -- \
      npx jest --config ./test/jest-e2e.json --runInBand --forceExit'

# security.yml runs on its own schedule/PR trigger; informational here, it
# never blocks build the way `needs:` does in ci.yml.
#
# `env -u npm_config_allow_scripts`: o `npm run` pai converte o campo
# allowScripts do package.json em variável de ambiente, e o npm aninhado lê
# isso como a flag --allow-scripts e aborta com EALLOWSCRIPTS. Só afeta o
# runner aninhado; o audit da CI roda direto e não vê a variável.
run_step npm-audit ci env -u npm_config_allow_scripts \
  bash -c 'npm audit --audit-level=high --omit=dev'

GATES_FAILED=$FAILED

# --- phase 2/3: chained jobs (needs:) --------------------------------------
if [ "$GATES_FAILED" = 0 ]; then
  run_step build ci bash -c 'npm run build'
  if [ "$FAILED" = 0 ] && [ "$SKIP_DOCKER" = 0 ]; then
    run_step docker-build ci bash -c 'docker build -t animesice-back:ci .'
  fi
fi

if [ "$STARTED_DB" = 1 ] && [ "$KEEP_DB" = 0 ]; then
  docker compose -f docker-compose.test.yml down -v >/dev/null 2>&1
fi

# --- summary ---------------------------------------------------------------
echo
for row in "${RESULTS[@]}"; do
  IFS='|' read -r status name dur _ <<<"$row"
  if [ "$status" = ok ]; then
    printf '  %s✔%s %-14s %s%s%s\n' "$GREEN" "$OFF" "$name" "$DIM" "$dur" "$OFF"
  else
    printf '  %s✘%s %-14s %s%s%s\n' "$RED" "$OFF" "$name" "$DIM" "$dur" "$OFF"
  fi
done

if [ "$FAILED" = 0 ]; then
  printf '\n%s%spipeline green%s (%s steps, %ss)\n' "$GREEN" "$OFF" "$OFF" "${#RESULTS[@]}" "$SECONDS"
else
  printf '\n%s%spipeline red%s — %s steps, %ss\n' "$RED" "$OFF" "$OFF" "${#RESULTS[@]}" "$SECONDS"
fi
exit "$FAILED"