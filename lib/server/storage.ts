import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const DIRS = {
  years: "years",
  tmdbPosters: "posters/tmdb",
  customPosters: "posters/custom",
  cache: "cache",
  thumbs: "cache/thumbs",
  exports: "exports",
} as const;

/** Resolves a relative POSIX path inside data/, rejecting traversal. */
export function dataPath(relative: string): string {
  const resolved = path.resolve(DATA_DIR, relative);
  const root = path.resolve(DATA_DIR) + path.sep;
  if (!resolved.startsWith(root)) throw new Error(`Path escapes data directory: ${relative}`);
  return resolved;
}

export function toRelative(absolute: string): string {
  return path.relative(DATA_DIR, absolute).split(path.sep).join("/");
}

export async function ensureDir(relative: string) {
  await fs.mkdir(dataPath(relative), { recursive: true });
}

export async function fileExists(absolute: string) {
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(relative: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(dataPath(relative), "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Could not read ${relative}: ${(error as Error).message}`);
  }
}

/** Writes to a temp file and renames it over the target, retrying transient Windows locks. */
export async function writeFileAtomic(absolute: string, data: string | Uint8Array) {
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const tmp = `${absolute}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, absolute);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw error;
    }
  }
}

export async function writeJson(relative: string, value: unknown) {
  await writeFileAtomic(dataPath(relative), JSON.stringify(value, null, 2) + "\n");
}

const globalLocks = globalThis as unknown as { __fyLocks?: Map<string, Promise<unknown>> };
const locks = (globalLocks.__fyLocks ??= new Map());

/** Serializes async work per key (e.g. one JSON file) within this process. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

export function sha1(value: string | Uint8Array) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "file";
}
