# Registro de decisão: worker Rust do Watchtower

Data: 2026-10-17
Escopo: migração dos jobs de descoberta e manutenção de catálogo do Watchtower para um worker Rust em container separado da API NestJS.

## Decisões

1. **Separação de processos.** A API NestJS continua atendendo endpoints administrativos e aceitando pedidos manuais. Um container Rust separado executa e agenda os tipos de job migrados. (Q1: usuário; confirmou worker separado.)
2. **Fila.** PostgreSQL permanece como fila durável na primeira etapa. A implementação deve fortalecer leases, checkpoints, retries e recuperação, sem acrescentar outro serviço de fila. (Q2: JEV, aceita; confiança 0,83.)
3. **Sem perda silenciosa.** O modelo é ao menos uma vez, com efeitos idempotentes, retomada após expiração de lease, falhas terminais visíveis e alerta para revisão ou reprocessamento. (Q3: JEV, aceita; confiança 0,95.)
4. **Escopo da migração.** Migrar descoberta de animes/episódios, scans de catálogo e reparos em segundo plano. A extração iniciada pelo player fica fora desta etapa e será tratada como fluxo separado, com requisitos próprios de latência. (Q4: usuário.)
5. **Agendamento único por tipo.** Após o corte de cada tipo, Rust assume seu agendamento e execução; o cron/executor correspondente no NestJS é desativado. NestJS mantém administração e pedidos manuais. Não pode haver dois schedulers/executores ativos para o mesmo tipo. (Q5: usuário.)
6. **Ordem do piloto.** Começar pelo processamento completo de reparos/fallback de episódios já existentes e controles de fila; depois portar descoberta incremental de animes/episódios e scans de catálogo; descoberta sazonal vem depois. O piloto Rust deve executar o reparo escolhido de ponta a ponta, não apenas o sweep NestJS que enfileira jobs. (Q6: usuário; etapas detalhadas com base na análise técnica.)
7. **Critério de corte.** Manter TypeScript como executor ativo até o Rust provar paridade por fonte e tipo de job. Fazer comparação sombra sem concorrer pela fila ativa, sem renovar leases ou gravar checkpoints/efeitos e sem duplicar chamadas externas apenas para comparar resultados. Cortar um fluxo de cada vez, com rollback que mantenha um único executor escritor. (Q7: usuário.)
8. **Identidade de catálogo segura.** Resolver a relação entre anime local, catálogo externo e temporada usando mappings explícitos e evidências da fonte; slug parecido não basta para unir registros. Quando houver mais de um candidato local ou risco de misturar franquias/temporadas, registrar conflito acionável e não fazer merge, redirect nem associação automática.
9. **Fila menor e limitada.** O worker não deve reproduzir nem ampliar o backlog atual. Usar deduplicação/coalescência por entidade e tipo, scans incrementais com cursor/checkpoint, limites de concorrência e de enqueue, e backpressure que adie trabalho de baixa urgência sem perder a necessidade de reavaliá-lo. Planejar a redução do backlog legado por prioridade/faixas, sem apagar jobs ou episódios automaticamente. Medir quantidade total, idade e volume por tipo; impedir starvation com capacidade reservada e aging.
10. **Descoberta orientada a mudanças.** Consultar índices disponíveis nas fontes (catálogo, listagem recente, sitemap/feed/API quando houver) e persistir IDs externos, fingerprints e cursor por fonte. Enfileirar só animes novos ou catálogos cujo conteúdo mudou; varrer listagens com janela de sobreposição para tolerar reordenação e usar reconciliação completa periódica e limitada para recuperar eventos perdidos. Só avançar o checkpoint depois de persistir resultados e jobs; falha temporária não avança cursor nem vira catálogo vazio.
11. **Failover de extração com validação.** Definir contrato de identidade `catálogo externo + temporada/episódio externos → anime/episódio locais + áudio`, incluindo transformações de numeração. Para episódio com extração falha ou mídia comprovadamente inválida, tentar outras fontes disponíveis usando mappings explícitos; slug/templates são último recurso. HTTP 200 e vídeo reproduzível não bastam: validar identidade do episódio, temporada e áudio com os sinais que a fonte oferece. Se a associação for ambígua, não publicar e encaminhar para revisão. Só substituir atomicamente a fonte/URL ativa após validação; falha transitória, bloqueio/429 e timeout não provam que a URL morreu. Preservar fonte anterior e tentativas. Não criar extrações redundantes enquanto houver job ativo deduplicado.
12. **Saúde de mídia e fontes.** Separar URL assinada expirada (renovar/reextrair conforme necessário) de página/adaptador quebrado. Aplicar cooldown por episódio, limites de tentativas e circuit breaker por fonte para evitar probes/reparos em loop; probes de saúde não devem preencher a fila de reparos em massa.
13. **Reconciliação de cobertura.** Periodicamente encontrar animes publicados sem mapping, com contagem desconhecida ou com evidência de episódios novos e garantir que sejam reavaliados. Ter episódios locais não é prova suficiente de que o catálogo externo está completo.

## Limites e pressupostos

- “Reparo em segundo plano” não inclui extração solicitada pelo player nem deve passar a depender dela implicitamente. Antes de codificar o piloto, mapear exatamente os tipos `WatchtowerJob`, as fontes e as dependências atuais de scraping/browser usadas pelo caminho de reparo.
- A execução sombra deve comparar entradas e saídas sobre fixtures/snapshots ou resultados já obtidos pelo executor ativo. Ela não consome jobs da fila ativa nem emite notificações, atualiza catálogo ou faz scraping duplicado sem uma decisão operacional explícita.
- O caso Steel Ball Run descrito pelo usuário é um cenário de aceitação ponta a ponta baseado em dados fornecidos, ainda não validado diretamente no banco nesta sessão. Na fase de catálogo, reconhecer que o slug específico pode não existir na fonte, consultar o mapping/catálogo da franquia e temporada, detectar episódios 4 e 5 ausentes no anime correto, enfileirar trabalho idempotente e dar atendimento dentro do objetivo de fila. Se a identidade local continuar ambígua, sinalizar para decisão administrativa sem mover dados automaticamente.
- A fila atual já coalesce jobs de scan por anime e limita o repair sweep, mas mantém uma linha de job por reparo de episódio. O novo desenho deve verificar onde um job batch/checkpoint reduz linhas sem dificultar retries, cancelamento, fairness e observabilidade; não presumir que “menos linhas” vale mais que preservar trabalho recuperável.
- Antes de fixar meta de redução, medir baseline e acompanhar chegada, conclusão, retries, trabalho vencido e idade por tipo. Batching só conta como melhora se reduzir trabalho/atraso pendente, não apenas a quantidade de linhas visíveis.
- Já há `AnimeSource`/`EpisodeSource`, `SourceDiscovery`, `Extractor` e health ranking no TypeScript. A migração deve reutilizar o conhecimento funcional dessas fontes e tornar explícito o resultado de probe: ausência definitiva, indisponibilidade/bloqueio e inconclusivo são estados diferentes.
- O estado atual já usa PostgreSQL com deduplicação, `FOR UPDATE SKIP LOCKED`, tentativas e backoff. Pontos encontrados para corrigir ou cobrir no desenho incluem falhas de enqueue engolidas, discovery que pode retornar sucesso após falha parcial, `Promise.race` sem cancelamento real e risco de worker antigo produzir efeitos após perder lock. Fencing e outbox devem ser avaliados na implementação contra os efeitos concretos de cada job.
- “Nunca falhar” não é garantia tecnicamente possível. O objetivo operacional é não perder trabalho silenciosamente, recuperar automaticamente falhas transitórias e tornar falhas terminais detectáveis e acionáveis.

## Critérios verificáveis para liberar o corte

- Um job em execução é retomado após encerramento abrupto do processo e expiração do lease, sem depender de intervenção manual.
- Escritas de um worker com lease expirado são rejeitadas por mecanismo de fencing ou equivalente demonstrável.
- Repetir o mesmo job não duplica episódios, fontes, notificações ou outros efeitos observáveis.
- Falhas transitórias aplicam retry/backoff; falhas terminais aparecem no estado administrativo e geram alerta acionável.
- A comparação sombra apresenta paridade por fonte e tipo, incluindo resultados vazios, 404/410 definitivos, falhas temporárias e comportamento das fontes que dependem de browser.
- O procedimento de corte e rollback deixa exatamente um executor escritor ativo por tipo de job.
- Backlog contínuo de REPAIR_EPISODE não impede SCAN_CATALOG, CHECK_RELEASES ou descoberta de progredir; aging pelo tempo vencido impede jobs antigos de congelarem indefinidamente, sem depender de um tick específico do cron. Idade e volume por tipo são consultáveis e alertáveis.
- Com a mesma carga de entrada, o worker não cria mais trabalho pendente que o fluxo atual; scans inalterados não geram novos jobs por ciclo. Comparar com baseline a chegada/conclusão, retries, idade e volume de trabalho vencido; demonstrar redução do atraso/backlog sem descarte e sem perder episode keys/checkpoints.
- Para fontes com índice incremental, uma execução seguinte sem mudança não volta a enfileirar o catálogo inteiro; mudança detectada enfileira apenas o trabalho correspondente, e falha ao consultar a fonte não avança o cursor.
- Uma URL de episódio só é substituída após a validação do fallback; bloqueio, rate limit, timeout ou erro de rede não apagam nem rebaixam uma fonte funcional registrada.
- O cenário de aceitação Steel Ball Run é repetível sem depender de dados vivos: 404 no slug específico, catálogo-base com temporada 6 e episódios 4/5, candidatos locais duplicados, mapping ausente e fila carregada de reparos. O resultado não pode associar o anime errado nem duplicar os jobs de extração.
- Ausência de mapping, catálogo desconhecido e evidências conflitantes são estados explícitos de reconciliação, não conclusões de catálogo completo.

## Proveniência

- Q1: confirmação direta do usuário.
- Q2 e Q3: decisões do JEV, aceitas e settled.
- Q4 e Q5: decisão original do JEV foi escalada por baixa confiança; as respostas posteriores do usuário resolveram ambas.
- Q6 e Q7: perguntadas ao usuário após o runner TypeSafe retornar `provider-error`; respostas do usuário, settled.
- O grafo Graphify e a leitura de `src/watchtower/catalog-scanner.service.ts`, `repair-worker.service.ts`, `season-discovery.service.ts` e `jobs.service.ts` fundamentam os limites técnicos acima.

## Riscos em aberto

- Algumas fontes podem depender de Playwright/Chromium/Xvfb. O piloto precisa decidir por fonte se Rust chama um serviço/adaptador existente ou se a cobertura será portada; o corte não pode reduzir silenciosamente fontes suportadas.
- A fila atual foi construída para os executores NestJS. Compatibilidade de payloads, enumerações, estados e chamadas administrativas precisa ser especificada antes de Rust operar sobre os mesmos jobs.
- Os limites de lease, heartbeat, fencing, timeout e retenção de histórico precisam ser derivados da duração real dos jobs e da operação atual; valores arbitrários podem gerar duplicação ou recuperação demorada.
- O objetivo operacional de atraso por classe (SLO) e as regras editoriais para conflitos/duplicatas precisam ser definidos com métricas reais. O worker pode detectar e colocar em revisão; não deve decidir por conta própria redirect 308, merge de animes ou remoção de registro.
- Nem todas as fontes expõem sitemap/feed/API/cursor confiável. Para cada fonte, escolher o melhor sinal disponível e definir cadência/limite; onde só houver scraping de listagem, usar paginação incremental e reconciliação limitada, sem prometer detecção instantânea.
- Reduzir o total de jobs não pode significar esconder falhas: batch jobs precisam manter checkpoint por anime/episódio e retry parcial, para que um erro não repita o lote inteiro nem marque itens não processados como concluídos.
- O ganho de “janela de sobreposição + fingerprint” depende da identidade estável oferecida por cada fonte; onde ela faltar, usar URL canonicalizada e metadados do episódio com limites de deduplicação explícitos.
- Algumas fontes não fornecem metadados suficientes para provar identidade/áudio de um vídeo. Definir nível de confiança mínimo por fonte; quando os sinais não sustentarem associação segura, registrar candidato para revisão em vez de substituir o playback atual.
- A suíte de aceitação do programa, distribuída pelas fases, deve cobrir incremental discovery → mapping → extração alternativa → validação → publicação atômica; fixtures devem incluir queda entre persistência e checkpoint, 429/timeout, backlog contínuo e proteção contra publicar episódio no anime errado.
- O primeiro release do piloto é menor: reparo/fallback de episódios existentes, persistência validada, recuperação e fairness. Descoberta incremental completa e caso Steel Ball Run end-to-end são gates das fases seguintes, antes de transferir esses crons para Rust.
