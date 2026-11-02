import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { errorMessage, jsonError } from "@/lib/server/http";
import { DATA_DIR, toRelative } from "@/lib/server/storage";

const EXCLUDED = [/^cache\/thumbs\//, /^exports\//, /\.tmp$/];

async function walk(dir: string, out: string[]) {
  let items: import("node:fs").Dirent[];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) await walk(abs, out);
    else if (item.isFile()) out.push(abs);
  }
}

/** Streams a ZIP with years/*.json, posters/ and the TMDb match cache. */
export async function GET() {
  try {
    const files: string[] = [];
    await walk(DATA_DIR, files);
    const zip = new JSZip();
    let count = 0;
    for (const abs of files) {
      const rel = toRelative(abs);
      if (EXCLUDED.some((re) => re.test(rel))) continue;
      const isJson = rel.endsWith(".json");
      zip.file(`data/${rel}`, createReadStream(abs), { compression: isJson ? "DEFLATE" : "STORE" });
      count++;
    }
    if (count === 0) return jsonError("There is no local data to back up yet.", 404);

    const stamp = new Date().toISOString().slice(0, 10);
    const stream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true });
    return new Response(Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="film-yearbook-backup-${stamp}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(`Backup failed: ${errorMessage(error)}`, 500);
  }
}
