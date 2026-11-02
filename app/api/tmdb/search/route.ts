import type { NextRequest } from "next/server";
import { errorMessage, jsonError } from "@/lib/server/http";
import { TmdbError, getMovie, searchMovies, tmdbConfigured, toCandidate } from "@/lib/server/tmdb";

/** Search TMDb by title (optionally with year), numeric TMDb ID or a themoviedb.org URL. */
export async function GET(request: NextRequest) {
  if (!tmdbConfigured()) return jsonError("TMDb is not configured. Add TMDB_API_TOKEN to .env.local and restart.", 503);
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q) return jsonError("Enter a title or TMDb ID.");
  const year = Number.parseInt(params.get("year") ?? "", 10);

  try {
    const idMatch = /^(\d+)$/.exec(q) ?? /themoviedb\.org\/movie\/(\d+)/.exec(q);
    if (idMatch) {
      try {
        return Response.json({ results: [toCandidate(await getMovie(Number(idMatch[1])))] });
      } catch (error) {
        if (!(error instanceof TmdbError && error.status === 404) || !/^\d+$/.test(q)) throw error;
        // A purely numeric query may also be a title (e.g. "1917").
      }
    }
    const results = await searchMovies(q, Number.isFinite(year) ? year : null);
    return Response.json({ results: results.slice(0, 20).map(toCandidate) });
  } catch (error) {
    return jsonError(errorMessage(error), error instanceof TmdbError && error.status === 404 ? 404 : 502);
  }
}
