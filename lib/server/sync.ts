import "server-only";
import type { AutoMatch, ProgressEvent, StoredEntry } from "@/lib/types";
import { resolveFilm } from "./matcher";
import { loadYear, readMatchCache, updateYear, writeMatchCache } from "./store";
import { dataPath, fileExists } from "./storage";
import { TmdbAuthError, downloadPoster } from "./tmdb";

const running = ((globalThis as unknown as { __fySyncs?: Set<number> }).__fySyncs ??= new Set());

async function needsWork(entry: StoredEntry, retryUnresolved: boolean) {
  const m = entry.match;
  if (!m) return true;
  if (m.status === "error") return true;
  if (m.status === "not_found") return retryUnresolved;
  if (m.posterPath && !m.poster) return !entry.override || retryUnresolved;
  if (m.poster && !(await fileExists(dataPath(m.poster.file)))) return !entry.override;
  return false;
}

export interface SyncSummary {
  films: number;
  matched: number;
  uncertain: number;
  notFound: number;
  errors: number;
  posterFailures: number;
}

/**
 * Resolves TMDb matches and downloads posters for films of a year that are new
 * or unresolved. Manual overrides are never modified.
 */
export async function syncYear(year: number, retryUnresolved: boolean, emit: (e: ProgressEvent) => void): Promise<SyncSummary> {
  if (running.has(year)) throw new Error("A poster sync for this year is already running.");
  running.add(year);
  try {
    const file = await loadYear(year);
    const groups = new Map<string, { name: string; releaseYear: number | null; allOverridden: boolean }>();
    for (const entry of file?.entries ?? []) {
      if (!(await needsWork(entry, retryUnresolved))) continue;
      const group = groups.get(entry.filmKey);
      if (group) group.allOverridden &&= Boolean(entry.override);
      else groups.set(entry.filmKey, { name: entry.source.name, releaseYear: entry.source.releaseYear, allOverridden: Boolean(entry.override) });
    }

    const summary: SyncSummary = { films: groups.size, matched: 0, uncertain: 0, notFound: 0, errors: 0, posterFailures: 0 };
    emit({ type: "start", total: groups.size, label: groups.size ? "Matching films on TMDb" : "Everything is up to date" });
    if (groups.size === 0) return summary;

    const cache = await readMatchCache();
    const cacheUpdates: Record<string, AutoMatch> = {};
    const pending = new Map<string, AutoMatch>();
    const state: { authError: Error | null } = { authError: null };
    let done = 0;

    const flush = async () => {
      if (pending.size === 0) return;
      const batch = new Map(pending);
      pending.clear();
      await updateYear(year, (f) => {
        for (const entry of f.entries) {
          const m = batch.get(entry.filmKey);
          if (m) entry.match = m;
        }
      });
    };

    const queue = [...groups.entries()];
    const worker = async () => {
      while (queue.length > 0 && !state.authError) {
        const [key, film] = queue.shift()!;
        let match: AutoMatch;
        try {
          const cached = cache[key];
          const reusable =
            cached && (cached.status === "matched" || cached.status === "uncertain" || (cached.status === "not_found" && !retryUnresolved));
          match = reusable ? { ...cached } : await resolveFilm(film.name, film.releaseYear);
          if (match.tmdbId && match.posterPath && !film.allOverridden) {
            try {
              match.poster = await downloadPoster(match.tmdbId, match.posterPath);
            } catch (error) {
              match.poster = null;
              match.message = `Poster download failed: ${(error as Error).message}`;
              summary.posterFailures++;
            }
          }
          if (match.status !== "error") cacheUpdates[key] = match;
        } catch (error) {
          if (error instanceof TmdbAuthError) {
            state.authError = error;
            break;
          }
          match = {
            status: "error",
            tmdbId: null,
            title: null,
            originalTitle: null,
            releaseYear: null,
            runtime: null,
            posterPath: null,
            poster: null,
            message: (error as Error).message,
            resolvedAt: new Date().toISOString(),
          };
        }
        if (match.status === "matched") summary.matched++;
        else if (match.status === "uncertain") summary.uncertain++;
        else if (match.status === "not_found") summary.notFound++;
        else summary.errors++;
        pending.set(key, match);
        done++;
        emit({ type: "progress", done, total: groups.size, label: film.name });
        if (pending.size >= 10) await flush();
      }
    };

    await Promise.all(Array.from({ length: 4 }, worker));
    await flush();
    await writeMatchCache(cacheUpdates);
    if (state.authError) throw state.authError;
    return summary;
  } finally {
    running.delete(year);
  }
}
