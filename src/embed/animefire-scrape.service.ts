// src/embed/animefire-scrape.service.ts
//
// DEPRECAÇÃO: a lógica multi-fonte agora vive em src/embed/scrape/scrape.service.ts.
// Este módulo existe apenas p/ manter o nome exportado p/ imports legados.
// Novos imports devem usar `ScrapeService` (via `@/embed/scrape/scrape.service`).
//
// O controlador EmbedController já foi migrado p/ ScrapeService.

export { ScrapeService as AnimefireScrapeService } from './scrape/scrape.service';
export type { ScrapeEpisodeResult } from './scrape/scrape-source.interface';
