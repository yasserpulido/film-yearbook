import "server-only";
import type { AutoMatch } from "@/lib/types";
import { titleSimilarity } from "./titles";
import { getMovie, releaseYearOf, searchMovies, type TmdbMovie, type TmdbSearchResult } from "./tmdb";

interface Scored {
  movie: TmdbSearchResult;
  titleSim: number;
  yearDiff: number | null;
  score: number;
}

function scoreCandidate(movie: TmdbSearchResult, name: string, year: number | null, extraTitles: string[] = []): Scored {
  const titles = [movie.title, movie.original_title, ...extraTitles].filter((t): t is string => Boolean(t));
  const titleSim = Math.max(0, ...titles.map((t) => titleSimilarity(name, t)));
  const releaseYear = releaseYearOf(movie.release_date);
  const yearDiff = year && releaseYear ? Math.abs(releaseYear - year) : null;
  const yearScore = yearDiff === null ? 0.4 : yearDiff === 0 ? 1 : yearDiff === 1 ? 0.6 : yearDiff === 2 ? 0.25 : 0;
  const popularity = Math.min(1, Math.log10((movie.vote_count ?? 0) + 1) / 4);
  return { movie, titleSim, yearDiff, score: titleSim * 0.65 + yearScore * 0.3 + popularity * 0.05 };
}

type Decision = { status: "matched" | "uncertain" | "not_found"; best: Scored | null; message: string | null };

function decide(scored: Scored[], name: string, year: number | null): Decision {
  const best = scored[0];
  if (!best) return { status: "not_found", best: null, message: "No results on TMDb." };
  const strong = (s: Scored) => s.titleSim >= 0.95 && (s.yearDiff === null || s.yearDiff <= 1);
  const label = year ? `“${name}” (${year})` : `“${name}”`;

  if (strong(best)) {
    const rivals = scored.slice(1).filter((s) => strong(s) && (s.yearDiff ?? 0) <= (best.yearDiff ?? 0));
    if (rivals.length === 0) return { status: "matched", best, message: null };
    const rivalVotes = Math.max(...rivals.map((r) => r.movie.vote_count ?? 0));
    if ((best.movie.vote_count ?? 0) >= 20 * Math.max(1, rivalVotes)) return { status: "matched", best, message: null };
    return { status: "uncertain", best, message: `Several TMDb films match ${label}. Please confirm.` };
  }
  if ((best.titleSim >= 0.75 && (best.yearDiff ?? 0) <= 1) || best.score >= 0.6) {
    return { status: "uncertain", best, message: `Closest TMDb match differs from ${label}. Please confirm.` };
  }
  return { status: "not_found", best: null, message: `No confident TMDb match for ${label}.` };
}

/** Finds the most plausible TMDb movie for a Letterboxd title + release year. */
export async function resolveFilm(name: string, year: number | null): Promise<AutoMatch> {
  const now = new Date().toISOString();
  const pool = new Map<number, TmdbSearchResult>();
  const add = (results: TmdbSearchResult[]) => results.forEach((r) => pool.set(r.id, r));
  const rank = (extra = new Map<number, string[]>()) =>
    [...pool.values()].map((m) => scoreCandidate(m, name, year, extra.get(m.id))).sort((a, b) => b.score - a.score);

  if (year) add(await searchMovies(name, year));
  let scored = rank();
  if (!scored.some((s) => s.titleSim >= 0.95 && (s.yearDiff ?? 0) <= 1)) {
    add(await searchMovies(name));
    scored = rank();
  }

  let decision = decide(scored, name, year);
  const details = new Map<number, TmdbMovie>();

  if (decision.status !== "matched" && scored.length > 0) {
    const extra = new Map<number, string[]>();
    for (const s of scored.slice(0, 3)) {
      const movie = await getMovie(s.movie.id, true);
      details.set(movie.id, movie);
      extra.set(movie.id, [
        ...(movie.alternative_titles?.titles ?? []).map((t) => t.title),
        ...(movie.translations?.translations ?? []).map((t) => t.data?.title ?? "").filter(Boolean),
      ]);
    }
    scored = rank(extra);
    decision = decide(scored, name, year);
  }

  if (!decision.best) {
    return {
      status: "not_found",
      tmdbId: null,
      title: null,
      originalTitle: null,
      releaseYear: null,
      runtime: null,
      posterPath: null,
      poster: null,
      message: decision.message,
      resolvedAt: now,
    };
  }

  const chosen = details.get(decision.best.movie.id) ?? (await getMovie(decision.best.movie.id));
  return {
    status: decision.status,
    tmdbId: chosen.id,
    title: chosen.title,
    originalTitle: chosen.original_title ?? null,
    releaseYear: releaseYearOf(chosen.release_date),
    runtime: chosen.runtime && chosen.runtime > 0 ? chosen.runtime : null,
    posterPath: chosen.poster_path ?? decision.best.movie.poster_path ?? null,
    poster: null,
    message: chosen.poster_path || decision.best.movie.poster_path ? decision.message : "TMDb has no poster for this film.",
    resolvedAt: now,
  };
}
