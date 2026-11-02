/** Lowercase, accent-free, punctuation-free title used for comparisons and keys. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const LEADING_ARTICLE = /^(the|a|an|el|la|los|las|le|les|l|der|die|das|il|lo|gli|i)\s+/;

/** Looser form: no leading article, no spaces. */
export function looseTitle(title: string): string {
  return normalizeTitle(title).replace(LEADING_ARTICLE, "").replace(/\s+/g, "");
}

function bigrams(value: string) {
  const s = value.replace(/\s+/g, "");
  const grams = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** 1 for equal titles, ~0.95 for article/spacing differences, Dice coefficient otherwise. */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (looseTitle(a) === looseTitle(b)) return 0.95;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of ga) {
    overlap += Math.min(n, gb.get(g) ?? 0);
    total += n;
  }
  for (const n of gb.values()) total += n;
  return total === 0 ? 0 : Math.min(0.9, (2 * overlap) / total);
}

export function filmKey(name: string, releaseYear: number | null) {
  return `${normalizeTitle(name)}|${releaseYear ?? ""}`;
}
