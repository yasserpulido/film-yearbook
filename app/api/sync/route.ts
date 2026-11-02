import { jsonError, parseYear, progressStream } from "@/lib/server/http";
import { syncYear } from "@/lib/server/sync";
import { tmdbConfigured } from "@/lib/server/tmdb";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { year?: unknown; retry?: unknown } | null;
  const year = parseYear(body?.year);
  if (!year) return jsonError("Invalid year.");
  if (!tmdbConfigured()) {
    return jsonError("TMDb is not configured. Add TMDB_API_TOKEN to .env.local and restart the app.", 503);
  }
  return progressStream((emit) => syncYear(year, body?.retry === true, emit));
}
