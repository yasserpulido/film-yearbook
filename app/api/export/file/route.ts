import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/http";
import { DIRS, dataPath } from "@/lib/server/storage";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") ?? "";
  const m = /^film-yearbook-\d{4}-A1-(portrait|landscape)\.(png|pdf)$/.exec(name);
  if (!m) return jsonError("Invalid file name.");
  const abs = dataPath(`${DIRS.exports}/${name}`);
  let size: number;
  try {
    size = (await fs.stat(abs)).size;
  } catch {
    return jsonError("This file has not been generated yet.", 404);
  }
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "content-type": m[2] === "png" ? "image/png" : "application/pdf",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
