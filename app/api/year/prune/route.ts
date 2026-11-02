import { errorMessage, jsonError, parseYear } from "@/lib/server/http";
import { pruneStale } from "@/lib/server/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { year?: unknown } | null;
  const year = parseYear(body?.year);
  if (!year) return jsonError("Invalid year.");
  try {
    return Response.json({ removed: await pruneStale(year) });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
