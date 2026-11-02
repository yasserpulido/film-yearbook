import "server-only";
import sharp from "sharp";
import type { PosterRef, TmdbCandidate, TmdbPosterOption } from "@/lib/types";
import { DIRS, dataPath, fileExists, safeSegment, writeFileAtomic } from "./storage";

const API_BASE = (process.env.TMDB_API_BASE || "https://api.themoviedb.org/3").replace(/\/$/, "");
const IMAGE_BASE = (process.env.TMDB_IMAGE_BASE || "https://image.tmdb.org/t/p").replace(/\/$/, "");
const LANGUAGE = process.env.TMDB_LANGUAGE || "en-US";

export class TmdbError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
export class TmdbAuthError extends TmdbError {}

function credentials() {
  const token = process.env.TMDB_API_TOKEN?.trim();
  const key = process.env.TMDB_API_KEY?.trim();
  return { token: token || null, key: key || null };
}

export function tmdbConfigured() {
  const { token, key } = credentials();
  return Boolean(token || key);
}

export interface TmdbSearchResult {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path: string | null;
  popularity?: number;
  vote_count?: number;
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  poster_path: string | null;
  vote_count?: number;
  popularity?: number;
  alternative_titles?: { titles?: { title: string }[] };
  translations?: { translations?: { data?: { title?: string } }[] };
}

interface TmdbImages {
  posters?: { file_path: string; width: number; height: number; iso_639_1: string | null; vote_average?: number; vote_count?: number }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const throttleState = globalThis as unknown as { __fyTmdbNext?: number };

/** Spaces requests to stay well below TMDb's rate limits. */
async function throttle() {
  const now = Date.now();
  const next = Math.max(now, throttleState.__fyTmdbNext ?? 0);
  throttleState.__fyTmdbNext = next + 30;
  if (next > now) await sleep(next - now);
}

function retryDelay(attempt: number, retryAfter: string | null) {
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1000 + 100);
  return Math.min(8000, 500 * 2 ** attempt);
}

async function tmdbGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const { token, key } = credentials();
  if (!token && !key) {
    throw new TmdbAuthError("TMDb is not configured. Add TMDB_API_TOKEN to .env.local and restart the app.");
  }
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  if (!token && key) url.searchParams.set("api_key", key);
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const maxAttempts = 5;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        await sleep(retryDelay(attempt, null));
        continue;
      }
      throw new TmdbError(`Could not reach TMDb (${(error as Error).message}). Check your internet connection.`);
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401) {
      throw new TmdbAuthError("TMDb rejected the credentials (401). Check TMDB_API_TOKEN / TMDB_API_KEY in .env.local.", 401);
    }
    if (res.status === 404) throw new TmdbError("Not found on TMDb.", 404);
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts - 1) {
      await sleep(retryDelay(attempt, res.headers.get("retry-after")));
      continue;
    }
    throw new TmdbError(
      res.status === 429 ? "TMDb rate limit reached. Try again in a minute." : `TMDb request failed (${res.status}).`,
      res.status,
    );
  }
}

export function releaseYearOf(date: string | undefined | null): number | null {
  const y = Number.parseInt((date ?? "").slice(0, 4), 10);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

export function tmdbImageUrl(filePath: string, size: string) {
  return `${IMAGE_BASE}/${size}${filePath}`;
}

export async function searchMovies(query: string, year?: number | null): Promise<TmdbSearchResult[]> {
  const data = await tmdbGet<{ results?: TmdbSearchResult[] }>("/search/movie", {
    query,
    year: year ?? undefined,
    include_adult: "false",
    language: LANGUAGE,
    page: 1,
  });
  return data.results ?? [];
}

export async function getMovie(id: number, withTitles = false): Promise<TmdbMovie> {
  return tmdbGet<TmdbMovie>(`/movie/${id}`, {
    language: LANGUAGE,
    append_to_response: withTitles ? "alternative_titles,translations" : undefined,
  });
}

export function toCandidate(m: TmdbSearchResult | TmdbMovie): TmdbCandidate {
  return {
    id: m.id,
    title: m.title,
    originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : null,
    releaseYear: releaseYearOf(m.release_date),
    posterPath: m.poster_path,
    thumbUrl: m.poster_path ? tmdbImageUrl(m.poster_path, "w185") : null,
  };
}

export async function getPosterOptions(id: number): Promise<TmdbPosterOption[]> {
  const [movie, images] = await Promise.all([getMovie(id), tmdbGet<TmdbImages>(`/movie/${id}/images`)]);
  const lang = LANGUAGE.slice(0, 2);
  const rank = (l: string | null) => (l === lang ? 0 : l === null ? 1 : l === "en" ? 2 : 3);
  const posters = (images.posters ?? []).slice().sort(
    (a, b) =>
      Number(b.file_path === movie.poster_path) - Number(a.file_path === movie.poster_path) ||
      rank(a.iso_639_1) - rank(b.iso_639_1) ||
      (b.vote_average ?? 0) - (a.vote_average ?? 0) ||
      b.width - a.width,
  );
  if (movie.poster_path && !posters.some((p) => p.file_path === movie.poster_path)) {
    posters.unshift({ file_path: movie.poster_path, width: 0, height: 0, iso_639_1: null });
  }
  return posters.map((p) => ({
    filePath: p.file_path,
    width: p.width,
    height: p.height,
    language: p.iso_639_1,
    thumbUrl: tmdbImageUrl(p.file_path, "w342"),
    primary: p.file_path === movie.poster_path,
  }));
}

const inflight = ((globalThis as unknown as { __fyDownloads?: Map<string, Promise<PosterRef>> }).__fyDownloads ??=
  new Map());

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

async function readPosterRef(rel: string): Promise<PosterRef | null> {
  try {
    const meta = await sharp(dataPath(rel)).metadata();
    if (!meta.width || !meta.height) return null;
    return { file: rel, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** Downloads the original-resolution poster once and reuses it from data/posters/tmdb afterwards. */
export async function downloadPoster(tmdbId: number, posterPath: string): Promise<PosterRef> {
  let name = `${tmdbId}-${safeSegment(posterPath.replace(/^\//, ""))}`;
  if (!/\.(jpe?g|png|webp)$/i.test(name)) name += ".jpg";
  const rel = `${DIRS.tmdbPosters}/${name}`;

  const pending = inflight.get(rel);
  if (pending) return pending;

  const job = (async () => {
    if (await fileExists(dataPath(rel))) {
      const cached = await readPosterRef(rel);
      if (cached) return cached;
    }
    const url = tmdbImageUrl(posterPath, "original");
    let lastError = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
        if (res.status === 404) throw new TmdbError("Poster image not found on TMDb.", 404);
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          await sleep(retryDelay(attempt, res.headers.get("retry-after")));
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const meta = await sharp(bytes).metadata();
        if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
          throw new TmdbError("TMDb returned an invalid image.");
        }
        await writeFileAtomic(dataPath(rel), bytes);
        return { file: rel, width: meta.width, height: meta.height };
      } catch (error) {
        if (error instanceof TmdbError) throw error;
        lastError = (error as Error).message;
        await sleep(retryDelay(attempt, null));
      }
    }
    throw new TmdbError(`Poster download failed (${lastError}).`);
  })();

  inflight.set(rel, job);
  try {
    return await job;
  } finally {
    inflight.delete(rel);
  }
}
