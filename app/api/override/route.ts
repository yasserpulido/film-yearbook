import { errorMessage, jsonError, parseEntryIds, parseYear } from "@/lib/server/http";
import { UserInputError, clearOverride, setTmdbOverride } from "@/lib/server/overrides";
import { tmdbConfigured } from "@/lib/server/tmdb";

interface Body {
  year?: unknown;
  entryIds?: unknown;
  tmdbId?: unknown;
  posterPath?: unknown;
}

async function readBody(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null;
  return { body, year: parseYear(body?.year), entryIds: parseEntryIds(body?.entryIds) };
}

/** Save a manual TMDb association / poster choice. */
export async function POST(request: Request) {
  const { body, year, entryIds } = await readBody(request);
  if (!year || !entryIds) return jsonError("Invalid year or diary entry.");
  const tmdbId = Number(body?.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return jsonError("Invalid TMDb movie ID.");
  const posterPath = typeof body?.posterPath === "string" && /^\/[A-Za-z0-9._-]+$/.test(body.posterPath) ? body.posterPath : null;
  if (!tmdbConfigured()) return jsonError("TMDb is not configured.", 503);
  try {
    await setTmdbOverride(year, entryIds, tmdbId, posterPath);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), error instanceof UserInputError ? 422 : 502);
  }
}

/** Remove the manual override so the automatic TMDb poster is used again. */
export async function DELETE(request: Request) {
  const { year, entryIds } = await readBody(request);
  if (!year || !entryIds) return jsonError("Invalid year or diary entry.");
  try {
    await clearOverride(year, entryIds);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), error instanceof UserInputError ? 422 : 500);
  }
}
