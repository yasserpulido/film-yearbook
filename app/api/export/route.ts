import { jsonError, parseYear, progressStream } from "@/lib/server/http";
import { generateExport } from "@/lib/server/exporter";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { year?: unknown; orientation?: unknown; order?: unknown } | null;
  const year = parseYear(body?.year);
  if (!year) return jsonError("Invalid year.");
  const orientation = body?.orientation === "landscape" ? "landscape" : "portrait";
  const order = body?.order === "asc" ? "asc" : "desc";
  return progressStream((emit) => generateExport(year, orientation, order, emit));
}
