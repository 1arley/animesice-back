# Extrator de Foil (`EXTRATOR_FOIL`) — Backend

## Visão geral

O **Extrator de Foil** (`EXTRATOR_FOIL`) é um item consumível que remove o foil especial aplicado a uma `UserCard` (`HOLO`, `GOLD`, `INK`, `PRISM` ou qualquer foil futuro registrado em `FOIL_INVENTORY_FIELDS`), converte-o de volta em fragmentos da gema correspondente e mantém a carta na coleção do jogador com seus demais atributos intactos (`condition`, `edition`, `skinId`, `originalUserId`, `obtainedAt` e `valueOverride`).

## Decisões arquiteturais

1. **Reaproveitamento de `ITEM_CATALOG` e `GachaInventory`**:
   - O campo inteiro `foilExtractors Int @default(0)` em `GachaInventory` (`prisma/schema.prisma`) integra o item nativamente ao pipeline de compra direta (`POST /gacha/economy/items/buy`), mercado de itens (`ITEM_CATALOG`) e inventário (`GET /gacha/economy`).
   - Em `src/gacha/economy/economy.rules.ts`, os consumíveis foram divididos em `STONE_ITEM_KINDS` e `DIRECT_CONSUMABLE_KINDS` (`['PROTECAO', 'EXTRATOR_FOIL']`), usando `isDirectConsumableKind` para rejeitar fabricação (`craftItem`) e conversão em cristais (`convertItem`), além de bloquear o uso de `EXTRATOR_FOIL` pelo endpoint de pedras (`UseItemDto`).
   - Endpoint dedicado (`POST /gacha/economy/gems/extract`) com DTO `ExtractFoilDto` e prévia autoritativa (`GET /gacha/economy/gems/extract/preview/:userCardId`), espelhando o fluxo de gemas em `/gacha/economy/gems/*`.

2. **Extensibilidade automática para futuros foils**:
   - `SpecialGachaFoil`, `SPECIAL_GACHA_FOILS` e `isSpecialGachaFoil` em `src/gacha/gacha.constants.ts` derivam diretamente das chaves de `FOIL_INVENTORY_FIELDS`. Qualquer novo foil adicionado a `FOIL_INVENTORY_FIELDS` passa a ser elegível automaticamente sem exigir alteração no fluxo de extração.

3. **Equilíbrio econômico e configuração**:
   - Fabricar uma gema exige `GEM_FRAGMENT_RECIPE = 20` fragmentos.
   - `foil_extract_fragments` em `GachaConfig` e no snapshot versionado (`GachaEconomyVersion`) define `{ default: 10 }` (com suporte a overrides por foil especial).
   - **Invariante econômico**: todo valor configurado em `foil_extract_fragments` deve ser inteiro no intervalo `1 <= qty < GEM_FRAGMENT_RECIPE` (`1..19`), garantindo impossibilidade de ciclo de lucro infinito (extrair nunca devolve `>= 20` fragmentos para refazer outra gema).
   - Validado tanto em `assertFoilExtractFragments` (antes de `assertItemShopSources` em `GachaConfigService.update` para retornar `BadRequestException` / HTTP 400 na edição admin) quanto em `assertItemShopSources` (`economy.config.ts`).
   - Preço padrão na loja: `item_shop_price.EXTRATOR_FOIL = 2000`, `item_shop_enabled.EXTRATOR_FOIL = true`, `item_convert_value.EXTRATOR_FOIL = 0`, `item_kind_weights.EXTRATOR_FOIL = 0` (migration `20261128120000_gacha_foil_extractor`).

4. **Recálculo de valor e integridade de ranking**:
   - Ao remover o foil para `'NORMAL'`, `value` é recalculado com `card.valueOverride ?? cardValue(..., 'NORMAL', ...)`.
   - Para impedir farm inflado de pontuação de ranking via aplicação/extração repetida, `rankedValue` é reduzido na mesma magnitude da perda de `value`:
     `newRankedValue = Math.max(0, card.rankedValue - Math.max(0, card.value - newValue))`.

5. **Concorrência, idempotência e bloqueios patrimoniais**:
   - `extractFoil` executa dentro de `withSerializableConflict` + `runOperation(..., 'EXTRACT_FOIL', ...)`, exigindo `operationId` UUID em `GachaItemOperation` para idempotência segura em retentativas.
   - Bloqueio determinístico de linhas na ordem `lockItemInventory(tx, userId)` seguido de `SELECT ... FROM "UserCard" ... FOR UPDATE`.
   - Decremento condicional de `foilExtractors: { gte: 1 }` e update condicional de `UserCard` (`status: 'ACTIVE'`, `foil: extractedFoil`).
   - Rejeita cartas com `card.status !== 'ACTIVE'`, `foil === 'NORMAL'`, envolvidas em troca `PENDING` (`GachaTrade` direto ou via `GachaTradeCard`), listagem `ACTIVE` não expirada (`GachaListing`), oferta `PENDING` não expirada (`GachaMarketOfferCard`), carta em destaque (`User.featuredUserCardId`) ou fora do status `'ACTIVE'`.

## Endpoints e filtros

- `GET /gacha/collection?eligibleKind=EXTRATOR_FOIL`: filtra apenas cartas `ACTIVE` do usuário com `foil != 'NORMAL'`.
- `GET /gacha/economy/gems/extract/preview/:userCardId`: retorna carta, foil atual, foil alvo (`NORMAL`), valor atual e projetado, ranking atual e projetado, extratores disponíveis, fragmentos a receber, `canExtract` e `blockedReason`.
- `POST /gacha/economy/gems/extract`: recebe `{ userCardId, operationId }`, executa a extração atômica e retorna `{ userCardId, extractedFoil, foil: 'NORMAL', value, rankedValue, extractorsRemaining, fragments }`.
