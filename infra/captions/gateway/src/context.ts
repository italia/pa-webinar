/**
 * Il contesto di una stanza, chiesto al portale: se i sottotitoli sono
 * attivi, in che lingua si parla e il vocabolario dell'evento (termini del
 * glossario, relatori, ente) con le forme sbagliate da correggere.
 *
 * Il bridge non dice a quale evento appartiene l'audio: il nome della stanza
 * arriva come parametro dell'URL quando Prosody lo mette nei metadati (da
 * stable-10978). Senza stanza, o se il portale non risponde, valgono i
 * default: sottotitoli attivi, lingua dell'istanza, nessun vocabolario.
 */

import type { AliasRule } from './captions.js';

export interface RoomContext {
  enabled: boolean;
  language: string;
  phrases: string[];
  aliases: AliasRule[];
}

const MAX_PHRASES = 100;
const MAX_PHRASE_CHARS = 80;
// Breve: la stanza rilegge il contesto per accorgersi di un interruttore
// cambiato dal vivo, e la cache serve solo a non moltiplicare le richieste.
const CACHE_MS = 4_000;

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.replace(/\s+/g, ' ').trim();
    if (clean && clean.length <= MAX_PHRASE_CHARS && !out.includes(clean)) out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

/** Valida la risposta del portale; ciò che non torna si scarta, non si inventa. */
export function parseContext(body: unknown, fallbackLanguage: string): RoomContext {
  const data = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const aliases: AliasRule[] = [];
  if (Array.isArray(data.aliases)) {
    for (const item of data.aliases) {
      if (typeof item !== 'object' || item === null) continue;
      const rule = item as Record<string, unknown>;
      if (typeof rule.term !== 'string' || !rule.term.trim()) continue;
      const forms = strings(rule.aliases, 20);
      if (forms.length > 0) aliases.push({ term: rule.term.trim(), aliases: forms });
    }
  }
  return {
    enabled: data.enabled !== false,
    language:
      typeof data.language === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$|^auto$/.test(data.language)
        ? data.language
        : fallbackLanguage,
    phrases: strings(data.phrases, MAX_PHRASES),
    aliases,
  };
}

export class ContextProvider {
  private cache = new Map<string, { at: number; value: RoomContext }>();

  constructor(
    private readonly opts: {
      url: string | null;
      token: string | null;
      defaultLanguage: string;
      timeoutMs?: number;
      now?: () => number;
    },
  ) {}

  private defaults(): RoomContext {
    return { enabled: true, language: this.opts.defaultLanguage, phrases: [], aliases: [] };
  }

  async get(room: string | null): Promise<RoomContext> {
    if (!this.opts.url) return this.defaults();
    const now = (this.opts.now ?? Date.now)();
    const key = room ?? '';
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.value;

    let value = this.defaults();
    try {
      const url = new URL(this.opts.url);
      if (room) url.searchParams.set('room', room);
      const res = await fetch(url, {
        // Le rotte interne del portale si autenticano con `x-api-key` (lib/auth/cron.ts).
        headers: this.opts.token ? { 'x-api-key': this.opts.token } : {},
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 2000),
      });
      if (res.ok) value = parseContext(await res.json(), this.opts.defaultLanguage);
      else console.warn(`[captions] contesto della stanza non disponibile (HTTP ${res.status})`);
    } catch (err) {
      console.warn(`[captions] contesto della stanza non disponibile: ${(err as Error).message}`);
    }
    this.cache.set(key, { at: now, value });
    return value;
  }
}
