import "server-only";
import type { EntryView, PosterRef, PosterSource, StoredEntry, YearFile, YearStats, YearView } from "@/lib/types";
import { dataPath, fileExists, sha1 } from "./storage";

export interface EffectivePoster {
  poster: PosterRef | null;
  source: PosterSource | null;
}

/** Manual override first, then the automatic TMDb match. */
export function effectivePoster(entry: StoredEntry): EffectivePoster {
  if (entry.override) return { poster: entry.override.poster, source: entry.override.kind === "upload" ? "upload" : "tmdb-manual" };
  if (entry.match?.poster) return { poster: entry.match.poster, source: "tmdb-auto" };
  return { poster: null, source: null };
}

function effectiveTmdb(entry: StoredEntry): EntryView["tmdb"] {
  const o = entry.override;
  const from = o?.kind === "tmdb" && o.tmdbId ? o : entry.match?.tmdbId ? entry.match : null;
  if (!from || !from.tmdbId) return null;
  return { id: from.tmdbId, title: from.title, releaseYear: from.releaseYear, runtime: from.runtime };
}

export function posterUrl(ref: PosterRef, version: string) {
  return `/api/image?path=${encodeURIComponent(ref.file)}&v=${encodeURIComponent(version)}`;
}

function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function computeStats(year: number, entries: EntryView[], hasRewatchColumn: boolean): YearStats {
  const today = new Date();
  const daysInYear = isLeap(year) ? 366 : 365;
  let daysCovered = daysInYear;
  let partialYear = false;
  if (year === today.getFullYear()) {
    const start = new Date(year, 0, 1);
    daysCovered = Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1);
    partialYear = daysCovered < daysInYear;
  }

  let runtimeMinutes = 0;
  let runtimeKnown = 0;
  for (const e of entries) {
    if (e.tmdb?.runtime) {
      runtimeMinutes += e.tmdb.runtime;
      runtimeKnown++;
    }
  }
  const count = entries.length;
  return {
    year,
    entries: count,
    uniqueFilms: new Set(entries.map((e) => e.tmdb?.id ?? e.filmKey)).size,
    runtimeMinutes,
    runtimeKnown,
    perMonth: count / (daysCovered / (daysInYear / 12)),
    perWeek: count / (daysCovered / 7),
    rewatches: hasRewatchColumn ? entries.filter((e) => e.rewatch).length : null,
    partialYear,
    daysCovered,
    missingPosters: entries.filter((e) => !e.posterUrl).length,
    uncertain: entries.filter((e) => e.matchStatus === "uncertain" && !e.hasOverride).length,
    pending: entries.filter((e) => e.matchStatus === "pending" && !e.hasOverride).length,
  };
}

export async function buildYearView(file: YearFile): Promise<YearView> {
  const entries: EntryView[] = [];
  const posters = file.entries.map(effectivePoster);
  const uniqueFiles = [...new Set(posters.flatMap((p) => (p.poster ? [p.poster.file] : [])))];
  const existing = new Set(
    (await Promise.all(uniqueFiles.map(async (f) => ((await fileExists(dataPath(f))) ? f : null)))).filter(Boolean),
  );
  for (const [i, e] of file.entries.entries()) {
    const { poster, source } = posters[i];
    const available = poster ? existing.has(poster.file) : false;
    const version = e.override?.updatedAt ?? e.match?.resolvedAt ?? "0";
    entries.push({
      id: e.id,
      filmKey: e.filmKey,
      name: e.source.name,
      releaseYear: e.source.releaseYear,
      watchedDate: e.source.watchedDate,
      rating: e.source.rating,
      rewatch: e.source.rewatch,
      letterboxdUri: e.source.letterboxdUri,
      importOrder: e.source.importOrder,
      stale: Boolean(e.stale),
      posterUrl: poster && available ? posterUrl(poster, sha1(`${poster.file}|${version}`).slice(0, 10)) : null,
      posterWidth: poster && available ? poster.width : null,
      posterHeight: poster && available ? poster.height : null,
      posterSource: available ? source : null,
      tmdb: effectiveTmdb(e),
      matchStatus: e.match?.status ?? "pending",
      matchMessage: e.match?.message ?? null,
      hasOverride: Boolean(e.override),
    });
  }
  return {
    year: file.year,
    entries,
    stats: computeStats(file.year, entries, file.hasRewatchColumn),
    lastImportAt: file.lastImportAt,
    staleCount: entries.filter((e) => e.stale).length,
  };
}
