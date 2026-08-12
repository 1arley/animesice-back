// Jest setup global: roda antes de qualquer módulo ser carregado.
// O EmbedService lê EMBED_ALLOWED_HOSTS no load do módulo (fail-closed);
// os specs unitários dele precisam de uma allowlist de teste. Ajuste com
// EMBED_ALLOWED_HOSTS no ambiente se necessário.
process.env.EMBED_ALLOWED_HOSTS =
  process.env.EMBED_ALLOWED_HOSTS || 'animefire.io';
