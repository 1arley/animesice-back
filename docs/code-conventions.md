# Code Conventions

## Comandos

| Comando            | Descrição      |
| ------------------ | -------------- |
| `npm run lint`     | Verifica erros |
| `npm run lint:fix` | Auto-corrige   |
| `npm run format`   | Formata código |

## ESLint

- Config: `eslint.config.mjs` (flat config)
- Plugins: `@eslint/js`, `typescript-eslint`, `eslint-plugin-prettier`

## Regras Customizadas

| Regra                  | Severidade |
| ---------------------- | ---------- |
| `no-floating-promises` | warn       |
| `no-unsafe-argument`   | warn       |
| `no-explicit-any`      | off        |

## Prettier

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "endOfLine": "auto"
}
```
