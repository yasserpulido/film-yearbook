import { promises as fs } from "node:fs";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { jsonError } from "@/lib/server/http";
import { DIRS, dataPath, fileExists, sha1, writeFileAtomic } from "@/lib/server/storage";

const WIDTHS = [160, 240, 360, 540, 800];
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Serves posters from data/posters, with cached WebP previews when ?w= is given. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rel = params.get("path") ?? "";
  if (!/^posters\/(tmdb|custom)\/[A-Za-z0-9._-]+$/.test(rel)) return jsonError("Invalid image path.");

  let abs: string;
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    abs = dataPath(rel);
    stat = await fs.stat(abs);
  } catch {
    return jsonError("Image not found.", 404);
  }
  const headers = { "cache-control": "public, max-age=31536000, immutable" };

  const requested = Number.parseInt(params.get("w") ?? "", 10);
  if (!Number.isFinite(requested)) {
    const ext = rel.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(await fs.readFile(abs)), {
      headers: { ...headers, "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  }

  const width = WIDTHS.find((w) => w >= requested) ?? WIDTHS[WIDTHS.length - 1];
  const thumbRel = `${DIRS.thumbs}/${sha1(`${rel}|${stat.size}|${stat.mtimeMs}|${width}`).slice(0, 24)}.webp`;
  const thumbAbs = dataPath(thumbRel);
  try {
    if (!(await fileExists(thumbAbs))) {
      const buffer = await sharp(abs, { failOn: "none" })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await writeFileAtomic(thumbAbs, buffer);
      return new Response(new Uint8Array(buffer), { headers: { ...headers, "content-type": "image/webp" } });
    }
    return new Response(new Uint8Array(await fs.readFile(thumbAbs)), { headers: { ...headers, "content-type": "image/webp" } });
  } catch {
    return jsonError("The image could not be decoded.", 422);
  }
}
