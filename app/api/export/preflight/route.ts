import type { NextRequest } from "next/server";
import { errorMessage, jsonError, parseYear } from "@/lib/server/http";
import { preflight } from "@/lib/server/exporter";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = parseYear(params.get("year"));
  if (!year) return jsonError("Invalid year.");
  const orientation = params.get("orientation") === "landscape" ? "landscape" : "portrait";
  try {
    return Response.json(await preflight(year, orientation));
  } catch (error) {
    return jsonError(errorMessage(error), 422);
  }
}
