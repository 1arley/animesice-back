# Confiança temporária para streams escolhidos

## Decisão

Guardar o host exato de mídia e a hora da verificação em `EpisodeSource` após
uma extração manual validada. O host permanece confiável por 24 horas. A URL
assinada não é persistida e `Episode.videoUrl` continua representando apenas o
stream padrão automático.

Hosts persistidos só autorizam `/embed/media`; não autorizam `/embed/proxy`.
O proxy continua resolvendo e pinando DNS, bloqueando IPs privados/reservados e
revalidando cada redirect antes da conexão.

## Evidência e proveniência

- Jev respondeu `accept`, mas com confiança `0.2`; marcou a questão como
  `needs-human` por risco de segurança e baixa confiança. Proveniência: `jev`.
- O usuário escolheu “Aprovar após revisar SSRF”. Proveniência: `user`.
- `resolveSafeUrl` resolve todos os endereços DNS, rejeita a resposta inteira
  quando qualquer endereço é interno e fixa o lookup usado pela conexão.
- `EmbedService.fetchSafe` usa redirects manuais e repete normalização,
  resolução DNS e bloqueio em cada hop. `embed.service.spec.ts` cobre redirect
  para IP interno.

## Limites e riscos restantes

- A confiança é por host, então o proxy de mídia pode buscar outros caminhos
  públicos do mesmo host durante a janela. A blocklist SSRF continua aplicada.
- O refresh periódico pode levar até uma hora para propagar um novo host entre
  réplicas; produção atualmente documenta confiança em memória por instância.
- O host expira 24 horas após a extração manual validada, sem renovação por
  consultar novamente um job concluído.
