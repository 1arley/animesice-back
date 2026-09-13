/**
 * TTL cache em-processo, mínimo. Espelha o padrão de `streaming.service.ts`
 * (Map + TTL + teto de entradas) mas genérico. NÃO é distribuído: cada réplica
 * mantém o seu; sob múltiplas réplicas cada uma paga 1 miss/TTL.
 *
 * ponytail: eviction é FIFO por ordem de inserção, não LRU estrito (get não
 * renova posição). Upgrade p/ LRU se o hit-rate importar de verdade.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size <= this.maxEntries) return;
    // Remove o mais antigo (Map preserva ordem de inserção).
    const oldest = this.store.keys().next();
    if (!oldest.done) this.store.delete(oldest.value);
  }
}
