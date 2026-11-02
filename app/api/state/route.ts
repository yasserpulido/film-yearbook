import type { AppState } from "@/lib/types";
import { errorMessage, jsonError } from "@/lib/server/http";
import { listYears } from "@/lib/server/store";
import { tmdbConfigured } from "@/lib/server/tmdb";

export async function GET() {
  try {
    const state: AppState = { years: await listYears(), tmdbConfigured: tmdbConfigured() };
    return Response.json(state, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(`Could not read local data: ${errorMessage(error)}`, 500);
  }
}
