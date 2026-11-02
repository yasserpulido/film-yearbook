export type Orientation = "portrait" | "landscape";
export type SortOrder = "desc" | "asc";

/** Normalized fields imported from Letterboxd. Never modified by the user. */
export interface DiarySource {
  name: string;
  releaseYear: number | null;
  watchedDate: string;
  loggedDate: string | null;
  letterboxdUri: string | null;
  rating: number | null;
  rewatch: boolean | null;
  tags: string[];
  importOrder: number;
}

export type MatchStatus = "matched" | "uncertain" | "not_found" | "error";

/** Poster file stored under data/, referenced by a relative POSIX path. */
export interface PosterRef {
  file: string;
  width: number;
  height: number;
}

/** Result of the automatic TMDb association. */
export interface AutoMatch {
  status: MatchStatus;
  tmdbId: number | null;
  title: string | null;
  originalTitle: string | null;
  releaseYear: number | null;
  runtime: number | null;
  posterPath: string | null;
  poster: PosterRef | null;
  message: string | null;
  resolvedAt: string;
}

/** Manual correction made by the user. Always wins over AutoMatch. */
export interface PosterOverride {
  kind: "tmdb" | "upload";
  tmdbId: number | null;
  title: string | null;
  releaseYear: number | null;
  runtime: number | null;
  posterPath: string | null;
  poster: PosterRef;
  updatedAt: string;
}

export interface StoredEntry {
  id: string;
  filmKey: string;
  source: DiarySource;
  match: AutoMatch | null;
  override: PosterOverride | null;
  /** True when the entry was absent from the most recent import. */
  stale?: boolean;
}

export interface YearFile {
  version: 1;
  year: number;
  updatedAt: string;
  lastImportAt: string | null;
  hasRewatchColumn: boolean;
  entries: StoredEntry[];
}

export type PosterSource = "upload" | "tmdb-manual" | "tmdb-auto";

export interface EntryView {
  id: string;
  filmKey: string;
  name: string;
  releaseYear: number | null;
  watchedDate: string;
  rating: number | null;
  rewatch: boolean | null;
  letterboxdUri: string | null;
  importOrder: number;
  stale: boolean;
  posterUrl: string | null;
  posterWidth: number | null;
  posterHeight: number | null;
  posterSource: PosterSource | null;
  tmdb: { id: number; title: string | null; releaseYear: number | null; runtime: number | null } | null;
  matchStatus: MatchStatus | "pending";
  matchMessage: string | null;
  hasOverride: boolean;
}

export interface YearStats {
  year: number;
  entries: number;
  uniqueFilms: number;
  runtimeMinutes: number;
  runtimeKnown: number;
  perMonth: number;
  perWeek: number;
  rewatches: number | null;
  partialYear: boolean;
  daysCovered: number;
  missingPosters: number;
  uncertain: number;
  pending: number;
}

export interface YearView {
  year: number;
  entries: EntryView[];
  stats: YearStats;
  lastImportAt: string | null;
  staleCount: number;
}

export interface AppState {
  years: { year: number; count: number }[];
  tmdbConfigured: boolean;
}

export interface ImportSummary {
  rows: number;
  imported: number;
  skipped: number;
  warnings: string[];
  years: { year: number; total: number; added: number; updated: number; unchanged: number; stale: number }[];
}

export interface TmdbCandidate {
  id: number;
  title: string;
  originalTitle: string | null;
  releaseYear: number | null;
  posterPath: string | null;
  thumbUrl: string | null;
}

export interface TmdbPosterOption {
  filePath: string;
  width: number;
  height: number;
  language: string | null;
  thumbUrl: string;
  primary: boolean;
}

export interface PreflightReport {
  year: number;
  orientation: Orientation;
  count: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  missing: { id: string; name: string }[];
  uncertain: { id: string; name: string }[];
  lowRes: { id: string; name: string; dpi: number }[];
}

export interface ExportResult {
  png: { name: string; bytes: number };
  pdf: { name: string; bytes: number };
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  seconds: number;
}

/** Events streamed (NDJSON) by long-running operations. */
export type ProgressEvent =
  | { type: "start"; total: number; label: string }
  | { type: "progress"; done: number; total: number; label: string }
  | { type: "done"; result?: unknown; message?: string }
  | { type: "error"; message: string };
