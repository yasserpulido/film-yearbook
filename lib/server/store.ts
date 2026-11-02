import "server-only";
import { promises as fs } from "node:fs";
import type { AutoMatch, DiarySource, ImportSummary, StoredEntry, YearFile } from "@/lib/types";
import type { ParsedDiary, ParsedEntry } from "./letterboxd";
import { DIRS, dataPath, readJson, withLock, writeJson } from "./storage";

const yearRel = (year: number) => `${DIRS.years}/${year}.json`;
const MATCH_CACHE = `${DIRS.cache}/tmdb-matches.json`;

export function isValidYear(year: number) {
  return Number.isInteger(year) && year >= 1870 && year <= 2200;
}

function emptyYear(year: number): YearFile {
  return { version: 1, year, updatedAt: new Date().toISOString(), lastImportAt: null, hasRewatchColumn: false, entries: [] };
}

export async function listYears(): Promise<{ year: number; count: number }[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dataPath(DIRS.years));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const years: { year: number; count: number }[] = [];
  for (const name of names) {
    const m = /^(\d{4})\.json$/.exec(name);
    if (!m) continue;
    const file = await loadYear(Number(m[1]));
    if (file && file.entries.length > 0) years.push({ year: file.year, count: file.entries.length });
  }
  return years.sort((a, b) => b.year - a.year);
}

export async function loadYear(year: number): Promise<YearFile | null> {
  if (!isValidYear(year)) return null;
  return readJson<YearFile | null>(yearRel(year), null);
}

/** Read-modify-write of a year file under a per-year lock. */
export async function updateYear(year: number, mutate: (file: YearFile) => void | Promise<void>): Promise<YearFile> {
  if (!isValidYear(year)) throw new Error(`Invalid year: ${year}`);
  return withLock(`year:${year}`, async () => {
    const file = (await readJson<YearFile | null>(yearRel(year), null)) ?? emptyYear(year);
    await mutate(file);
    file.updatedAt = new Date().toISOString();
    await writeJson(yearRel(year), file);
    return file;
  });
}

function sameSource(a: DiarySource, b: DiarySource) {
  const strip = (s: DiarySource) => JSON.stringify({ ...s, importOrder: 0 });
  return strip(a) === strip(b);
}

/**
 * Merges a freshly parsed diary into the saved years. Existing matches and
 * manual overrides are kept; entries missing from the new export are kept and
 * flagged as stale instead of being deleted.
 */
export async function importDiary(diary: ParsedDiary): Promise<ImportSummary> {
  const incomingByYear = new Map<number, ParsedEntry[]>();
  for (const entry of diary.entries) {
    const year = Number(entry.source.watchedDate.slice(0, 4));
    if (!incomingByYear.has(year)) incomingByYear.set(year, []);
    incomingByYear.get(year)!.push(entry);
  }
  const incomingYearOf = new Map(diary.entries.map((e) => [e.id, Number(e.source.watchedDate.slice(0, 4))]));

  const existingYears = (await listYears()).map((y) => y.year);
  const allYears = [...new Set([...existingYears, ...incomingByYear.keys()])].sort((a, b) => a - b);

  // Entries whose watched date moved to another year carry their match/override along.
  const carried = new Map<string, StoredEntry>();
  for (const year of existingYears) {
    const file = await loadYear(year);
    for (const entry of file?.entries ?? []) {
      const target = incomingYearOf.get(entry.id);
      if (target !== undefined && target !== year) carried.set(entry.id, entry);
    }
  }

  const now = new Date().toISOString();
  const summary: ImportSummary = {
    rows: diary.rows,
    imported: diary.entries.length,
    skipped: diary.skipped,
    warnings: diary.warnings,
    years: [],
  };

  for (const year of allYears) {
    const incoming = incomingByYear.get(year) ?? [];
    const stats = { year, total: 0, added: 0, updated: 0, unchanged: 0, stale: 0 };
    await updateYear(year, (file) => {
      const existing = new Map(file.entries.map((e) => [e.id, e]));
      const incomingIds = new Set(incoming.map((e) => e.id));
      const next: StoredEntry[] = [];

      for (const item of incoming) {
        const previous = existing.get(item.id) ?? carried.get(item.id);
        if (!previous) {
          stats.added++;
          next.push({ id: item.id, filmKey: item.filmKey, source: item.source, match: null, override: null });
          continue;
        }
        if (sameSource(previous.source, item.source) && !previous.stale) stats.unchanged++;
        else stats.updated++;
        const merged: StoredEntry = {
          id: item.id,
          filmKey: item.filmKey,
          source: item.source,
          match: previous.filmKey === item.filmKey ? previous.match : null,
          override: previous.override,
        };
        next.push(merged);
      }

      for (const entry of file.entries) {
        if (incomingIds.has(entry.id) || incomingYearOf.has(entry.id)) continue;
        stats.stale++;
        next.push({ ...entry, stale: true });
      }

      file.entries = next;
      file.lastImportAt = now;
      file.hasRewatchColumn = diary.hasRewatchColumn || file.hasRewatchColumn;
      stats.total = next.length;
    });
    summary.years.push(stats);
  }

  summary.years.sort((a, b) => b.year - a.year);
  return summary;
}

export async function pruneStale(year: number) {
  let removed = 0;
  await updateYear(year, (file) => {
    const before = file.entries.length;
    file.entries = file.entries.filter((e) => !e.stale);
    removed = before - file.entries.length;
  });
  return removed;
}

export async function readMatchCache(): Promise<Record<string, AutoMatch>> {
  return readJson<Record<string, AutoMatch>>(MATCH_CACHE, {});
}

export async function writeMatchCache(updates: Record<string, AutoMatch>) {
  if (Object.keys(updates).length === 0) return;
  await withLock("match-cache", async () => {
    const cache = await readJson<Record<string, AutoMatch>>(MATCH_CACHE, {});
    Object.assign(cache, updates);
    await writeJson(MATCH_CACHE, cache);
  });
}
