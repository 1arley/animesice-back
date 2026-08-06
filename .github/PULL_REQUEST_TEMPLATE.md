<!-- Provide a concise, clear PR description. -->

## Summary

<!-- What does this change do and why? Reference any related issue. -->

Closes #

## Change type

<!-- Check one. Conventional Commits is enforced via commitlint. -->

- [ ] feat (new feature)
- [ ] fix (bug fix)
- [ ] docs (documentation)
- [ ] refactor
- [ ] perf
- [ ] test
- [ ] chore / ci / build
- [ ] breaking change

## Checklist

- [ ] Conventional Commit message used (`feat:`, `fix(scope):`, …)
- [ ] `npm run lint` passes
- [ ] `npx prettier --check "src/**/*.ts" "test/**/*.ts"` passes
- [ ] `npx tsc --noEmit -p tsconfig.json` passes
- [ ] `npm run test:unit` passes
- [ ] `npm run test:e2e` passes (requires a running Postgres test DB)
- [ ] `npm run build` passes
- [ ] No secrets / `.env` files committed
- [ ] Prisma migrations added/updated when schema changes (`npm run prisma:migrate`)

## Notes for reviewer / deployment

<!-- Anything special to review, migrations, env vars, or deploy steps. -->
