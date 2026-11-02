import type { NextRequest } from "next/server";
import { errorMessage, jsonError, parseYear } from "@/lib/server/http";
import { loadYear } from "@/lib/server/store";
import { buildYearView } from "@/lib/server/view";

export async function GET(request: NextRequest) {
  const year = parseYear(request.nextUrl.searchParams.get("year"));
  if (!year) return jsonError("Invalid year.");
  try {
    const file = await loadYear(year);
    if (!file) return jsonError(`No diary entries for ${year}.`, 404);
    return Response.json(await buildYearView(file), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(`Could not load ${year}: ${errorMessage(error)}`, 500);
  }
}
