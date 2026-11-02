import "server-only";
import sharp from "sharp";
import type { PosterOverride, YearFile } from "@/lib/types";
import { updateYear } from "./store";
import { DIRS, dataPath, fileExists, safeSegment, sha1, writeFileAtomic } from "./storage";
import { downloadPoster, getMovie, releaseYearOf } from "./tmdb";

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const UPLOAD_FORMATS: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export class UserInputError extends Error {}

function applyOverride(file: YearFile, entryIds: string[], override: PosterOverride | null) {
  const ids = new Set(entryIds);
  let touched = 0;
  for (const entry of file.entries) {
    if (!ids.has(entry.id)) continue;
    entry.override = override;
    touched++;
  }
  if (touched === 0) throw new UserInputError("The selected diary entry no longer exists. Reload the page.");
}

export async function setTmdbOverride(year: number, entryIds: string[], tmdbId: number, posterPath: string | null) {
  const movie = await getMovie(tmdbId);
  const path = posterPath || movie.poster_path;
  if (!path) throw new UserInputError("This film has no poster on TMDb. Upload an image instead.");
  const poster = await downloadPoster(tmdbId, path);
  const override: PosterOverride = {
    kind: "tmdb",
    tmdbId,
    title: movie.title,
    releaseYear: releaseYearOf(movie.release_date),
    runtime: movie.runtime && movie.runtime > 0 ? movie.runtime : null,
    posterPath: path,
    poster,
    updatedAt: new Date().toISOString(),
  };
  await updateYear(year, (file) => applyOverride(file, entryIds, override));
}

/** Validates an uploaded image and stores its original bytes under data/posters/custom. */
export async function setUploadOverride(year: number, entryIds: string[], bytes: Uint8Array) {
  if (bytes.byteLength === 0) throw new UserInputError("The uploaded file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UserInputError("The image is larger than 60 MB.");

  let format: string | undefined;
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes).metadata();
    format = meta.format;
    width = meta.autoOrient?.width ?? meta.width ?? 0;
    height = meta.autoOrient?.height ?? meta.height ?? 0;
    await sharp(bytes, { failOn: "error" }).resize(64).toBuffer();
  } catch {
    throw new UserInputError("The file is not a valid image or is corrupted.");
  }
  const ext = format ? UPLOAD_FORMATS[format] : undefined;
  if (!ext) throw new UserInputError("Unsupported image format. Use JPEG, PNG or WebP.");
  if (width < 100 || height < 100) throw new UserInputError("The image is too small to print (minimum 100 × 100 px).");

  const rel = `${DIRS.customPosters}/${safeSegment(entryIds[0])}-${sha1(bytes).slice(0, 10)}.${ext}`;
  if (!(await fileExists(dataPath(rel)))) await writeFileAtomic(dataPath(rel), bytes);

  const override: PosterOverride = {
    kind: "upload",
    tmdbId: null,
    title: null,
    releaseYear: null,
    runtime: null,
    posterPath: null,
    poster: { file: rel, width, height },
    updatedAt: new Date().toISOString(),
  };
  await updateYear(year, (file) => applyOverride(file, entryIds, override));
}

export async function clearOverride(year: number, entryIds: string[]) {
  await updateYear(year, (file) => applyOverride(file, entryIds, null));
}
