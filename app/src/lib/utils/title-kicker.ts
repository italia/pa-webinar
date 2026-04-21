export interface KickerParts {
  kicker: string | null;
  main: string;
}

export function splitTitleKicker(title: string, enabled: boolean): KickerParts {
  if (!enabled) return { kicker: null, main: title };
  const idx = title.indexOf('|');
  if (idx === -1) return { kicker: null, main: title };
  const kicker = title.slice(0, idx).trim();
  const main = title.slice(idx + 1).trim();
  if (!kicker || !main) return { kicker: null, main: title };
  return { kicker, main };
}
