import type { NextRequest } from "next/server";
import { errorMessage, jsonError } from "@/lib/server/http";
import { getPosterOptions, tmdbConfigured } from "@/lib/server/tmdb";

export async function GET(request: NextRequest) {
  if (!tmdbConfigured()) return jsonError("TMDb is not configured. Add TMDB_API_TOKEN to .env.local and restart.", 503);
  const id = Number.parseInt(request.nextUrl.searchParams.get("id") ?? "", 10);
  if (!Number.isInteger(id) || id <= 0) return jsonError("Invalid TMDb movie ID.");
  try {
    return Response.json({ posters: await getPosterOptions(id) });
  } catch (error) {
    return jsonError(errorMessage(error), 502);
  }
}
