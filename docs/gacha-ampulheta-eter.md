# Ampulheta do Éter (`AMPULHETA_ETER`) — Backend

## Visão geral

A **Ampulheta do Éter** (`AMPULHETA_ETER`) é um consumível que remove o cooldown de
claim do gacha (`GachaClaimLock`) sem custo em dinheiro real — a alternativa gratuita
ao bypass pago (`bypassPriceCents`). Ela cai no resgate de uma carta e é consumida por
um endpoint dedicado.

## Item e inventário

1. **`ITEM_CATALOG` + `GachaInventory`**: uma linha no catálogo
   (`{ id: 'AMPULHETA_ETER', name: 'Ampulheta do Éter', field: 'ampulhetaEter' }`) e uma
   coluna `ampulhetaEter Int @default(0)` (`prisma/schema.prisma`). Com isso o item herda
   `creditItems` (proteção de overflow contra `MAX_INT` e reserva de escrow), listagens,
   ofertas e trocas, sem código novo.
2. **Fora de `ITEM_KINDS`**: `ITEM_KINDS` representa itens de melhoria/forja/loja de
   fragmentos. A Ampulheta não é fabricável (`craftItem`), não é convertível em cristais
   (`convertItem`) e não é usável pelo endpoint de pedras (`UseItemDto`).

## Drop no claim

- Sorteada **dentro da transação de `GachaService.claim()`**, depois da trava de
  idempotência `gachaSpin.updateMany({ where: { id, claimedAt: null } })`. Sortear em
  `spin()` (preview) permitiria farm grátis por quem nunca resgata a carta.
- Chance `ampulheta_drop_chance` (%, default `0.5`) e chave geral `ampulheta_enabled`
  (default `true`), ambas em `GachaConfig`, validadas em `GachaConfigService.update`
  (`assertChancePercent` 0–100 / `assertBooleanConfig`) e lidas do cache via
  `ampulhetaDropChance` / `ampulhetaEnabled`.
- A resposta do claim ganha `ampulhetaDropped: true` **somente** quando o item caiu; nos
  demais casos o corpo do claim permanece igual.
- O drop é **best-effort**: se `creditItems` bater no teto de inventário, o 409 é
  convertido em “sem drop” (warning no log) e o claim continua — o jogador perde o bônus,
  nunca a carta. O `updateMany` condicional devolve `count: 0` sem erro de Postgres, então
  a transação permanece válida.

## Uso: `POST /gacha/economy/ampulheta/use`

Corpo: `{ operationId: uuid }` (`UseAmpulhetaDto`). Retorna
`{ used: true, inventory }` com o inventário atualizado.

Ordem de execução, dentro de `runOperation(..., 'USE_AMPULHETA', ...)` (transação
`Serializable` + retry de conflito + replay idempotente por `operationId`):

1. `assertEconomyEnabled(tx, userId)` — 403 com saldo negativo, revisão de mercado ou fora
   de `economy_rollout_percent`.
2. `lockItemInventory(tx, userId)` — upsert do inventário + `SELECT ... FOR UPDATE`.
3. Recusa durante `claim_event` ativo (o evento já fixa o cooldown em 1h e mexe na
   economia da coleta), igual ao bypass pago.
4. Exige `GachaClaimLock` com `lockedUntil > now`.
5. `updateMany({ where: { userId, ampulhetaEter: { gte: 1 } }, data: { ampulhetaEter: { decrement: 1 } } })`
   — decremento condicional; `count !== 1` → 400.
6. `deleteMany({ where: { userId, lockedUntil: { gt: now } } })` — se nenhuma linha sair,
   lança erro para o rollback desfazer o decremento.

| Situação | HTTP |
| --- | --- |
| Uso concluído | 201 |
| Economia bloqueada para a conta (saldo negativo, revisão, rollout) | 403 |
| Sem cooldown ativo / lock já removido | 400 `Não há tempo de espera ativo.` |
| Sem Ampulheta no inventário | 400 `Ampulheta do Éter insuficiente.` |
| `claim_event` ativo | 400 |
| Mesmo `operationId` reenviado | 201 com o resultado original, sem consumir de novo |

## Descoberta pelo front

`GET /gacha/status` devolve `ampulhetaCount` (quantidade no inventário) ao lado de
`bypassPriceCents`, para a tela de claim escolher entre o bypass pago e a Ampulheta.
O uso também fica condicionado a `canClaim === false` e `claimEvent === null`.

## Migration

`20261128130000_gacha_ampulheta_eter`: adiciona `GachaInventory.ampulhetaEter` e insere
`ampulheta_drop_chance` / `ampulheta_enabled` em `GachaConfig` com `ON CONFLICT DO UPDATE`
que **preserva** valor já válido (número 0–100 / boolean) e só cai no default quando o
valor existente é inválido.

## Testes

- Unitários: `gacha.service.spec.ts` (drop a 100% / 0% / desabilitada, `ampulhetaCount` no
  status) e `economy.service.spec.ts` (sem cooldown, sem item, evento ativo, rollback do
  delete, replay e duas requisições concorrentes com `operationId` distintos).
- E2E (`test/gacha.e2e-spec.ts`): uso + idempotência com Postgres real, recusas sem
  consumo e drop determinístico no claim com `ampulheta_drop_chance = 100`.
