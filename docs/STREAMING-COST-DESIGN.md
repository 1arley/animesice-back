# Design: reduzir custo do streaming

## Decisão proposta

Migrar gradualmente o tráfego de vídeo do proxy integral para uma CDN com suporte nativo a `Range` e URLs assinadas de curta duração. O backend continuaria autorizando a reprodução, mas retornaria uma URL assinada; os bytes seguiriam diretamente da CDN ao cliente. Para origens que exigem `Referer`, token vinculado a IP ou não permitem distribuição, o proxy atual permanece como fallback.

## Alternativas e trade-offs

**URL assinada na origem/CDN:** elimina quase toda a banda e conexões longas do backend, melhora seek e permite cache de segmentos/ranges. Exige controle da origem ou CDN capaz de buscar e armazenar o objeto. URLs podem ser compartilhadas durante o TTL; mitigar com validade curta, assinatura de caminho/claims e, somente quando confiável, vínculo aproximado a IP.

**CDN diante do proxy:** implantação simples e preserva a API, mas conteúdo personalizado por token reduz cache hit. A chave de cache deve ignorar credenciais e variar apenas por objeto e `Range`, após autorização na borda.

**Proxy integral:** mantém origem e cabeçalhos ocultos e concentra validação SSRF, porém duplica o custo de banda, ocupa sockets/CPU e torna o backend gargalo. URLs diretas reduzem a superfície SSRF no hot path, mas expõem o hostname da mídia e transferem controles de allowlist, redirects e DNS rebinding para o processo de ingestão/origin shield. Nunca assinar uma URL arbitrária enviada pelo cliente.

## Plano faseado

1. Instrumentar bytes, egress, taxa de `Range`, cache hit, 403 e fallback por provedor; definir allowlist de origens e IDs internos imutáveis.
2. Pilotar uma resolução/provedor controlado: backend autoriza e emite URL CDN assinada por 2–5 minutos; CDN valida assinatura, suporta `206` e restringe origin fetch à allowlist.
3. Fazer rollout percentual, mantendo proxy automático para origens incompatíveis. Comparar custo por hora assistida, startup, seek e erros.
4. Expandir por provedor; mover assinatura para edge quando seguro. Revogar por rotação de chave/versão do objeto e limitar taxa.
5. Após estabilidade, retirar o proxy integral das fontes elegíveis, preservando-o como fallback monitorado e com orçamento de egress.
