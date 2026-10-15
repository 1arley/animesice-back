# Trade-up — registro de decisões

Sessão grill-with-jev: `trade-up-2026-10-15`  
Estado: decisões fechadas; implementação aguardando confirmação deste registro.

## Decisões

| Tema | Decisão | Proveniência |
|---|---|---|
| Trade-up de cartas | Consumir 4 cópias da mesma raridade e criar 1 carta da raridade imediatamente superior. | Usuário confirmou Q1. |
| Carta resultante | Sortear uma carta ativa elegível da raridade seguinte, com peso adicional para cartas na wishlist do próprio usuário. A wishlist aumenta a chance, mas não garante o resultado. | Usuário aprovou Q2 após escalada do JEV. |
| Condition, foil e edition | Sortear os atributos separadamente. As quatro entradas influenciam as chances de atributos melhores; preferências de wishlist adicionam peso às opções compatíveis sem garantir correspondência. | Usuário aprovou Q2 e Q5 após escaladas do JEV. |
| Limite de raridade | Rejeitar trade-up na raridade máxima ou quando não houver carta elegível na raridade seguinte, antes de consumir entradas. | Usuário aprovou Q3 após escalada do JEV. |
| Proteção do inventário | Aceitar apenas cópias `ACTIVE` do usuário; IDs devem ser distintos. Validar e consumir as entradas e conceder a saída em uma transação atômica. | Usuário aprovou Q4 após escalada do JEV. |
| Trade-up de skins | Consumir 3 skins da mesma raridade e sortear uniformemente 1 skin ativa, não bloqueada, dessa raridade. Rejeitar se o pool estiver vazio, antes do consumo. | Usuário confirmou Q1 e Q6 após escalada do JEV. |
| Persistência | Marcar as entradas como `BURNED` e criar a cópia resultante na mesma transação. Falhas revertem toda a operação. A resposta retorna o resultado e os IDs consumidos. | Usuário confirmou Q7 após escalada do JEV. |

## Premissas para implementação

- A wishlist relevante é a do usuário que executa o trade-up, não a de outros usuários.
- `condition` é melhor quanto menor seu valor; `edition` segue a regra existente de wishlist, em que uma edição menor pode satisfazer `maxEdition`.
- Os pesos numéricos finais para combinar atributos das entradas, preferências da wishlist e pesos normais de foil serão simples e limitados para que nenhuma entrada ou preferência garanta um resultado.
- Somente cartas do catálogo com status `ACTIVE` entram no pool de resultados.

## Riscos em aberto

- As regras definem direção e influência dos pesos, mas não fixam percentuais nem limites numéricos. A implementação precisa escolher valores concretos e mantê-los pequenos, determinísticos de testar e sem garantias indevidas.
- Trade-up é irreversível para as cópias consumidas. A atomicidade, a validação de propriedade/status e o bloqueio de IDs duplicados são requisitos centrais.
- A confirmação deste registro autoriza iniciar a implementação; não autoriza migração em banco de produção ou publicação.

## Histórico do JEV

- Q1 foi escalada pelo JEV por envolver consumo de inventário e baixa confiança; o usuário confirmou a proposta.
- Q2–Q4 foram escaladas por risco/confiança; o usuário respondeu “avance”, registrado como aprovação das recomendações apresentadas.
- Q5–Q7 foram escaladas por risco/confiança; o usuário confirmou as três recomendações.
- O JEV forneceu recomendações de desenho. As decisões finais e aprovações registradas acima são do usuário.
