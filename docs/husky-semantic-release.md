# Husky & Semantic Release

## Hooks

- **pre-commit**: Lint-staged (ESLint + Prettier nos arquivos staged)
- **commit-msg**: Valida Conventional Commits

## Commits

Formato: `<tipo>(<escopo>): <descrição>`

**Tipos:**
| Tipo | Descrição | Version |
|------|-----------|---------|
| `feat` | Nova funcionalidade | minor |
| `fix` | Bug fix | patch |
| `docs` | Documentação | - |
| `refactor` | Refatoração | - |
| `test` | Testes | - |
| `chore` | Manutenção | - |

**Exemplo:** `feat(auth): add password reset`

## Lint-Staged

```json
{
  "*.ts": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

## Scripts

- `npm run release` - Executa release
- `npm run release:dry` - Simula release

## Troubleshooting

```bash
# Reinstalar hooks
npm run prepare

# Testar mensagem
echo "feat: test" | npx commitlint
```
