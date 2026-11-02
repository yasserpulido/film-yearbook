import "server-only";
import Papa from "papaparse";
import JSZip from "jszip";
import type { DiarySource } from "@/lib/types";
import { filmKey, normalizeTitle } from "./titles";
import { sha1 } from "./storage";

export class DiaryFormatError extends Error {}

export interface ParsedEntry {
  id: string;
  filmKey: string;
  source: DiarySource;
}

export interface ParsedDiary {
  entries: ParsedEntry[];
  rows: number;
  skipped: number;
  warnings: string[];
  hasRewatchColumn: boolean;
}

const MAX_WARNINGS = 50;

function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "");
}

/** Accepts either diary.csv or the full Letterboxd export ZIP and returns the diary CSV text. */
export async function extractDiaryCsv(bytes: Uint8Array): Promise<string> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return decodeText(bytes);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new DiaryFormatError("The ZIP file could not be opened. Re-download your Letterboxd export and try again.");
  }
  const candidates = Object.values(zip.files)
    .filter((f) => !f.dir && /(^|\/)diary\.csv$/i.test(f.name) && !/(^|\/)(deleted|orphaned)\//i.test(f.name))
    .sort((a, b) => a.name.length - b.name.length);
  if (candidates.length === 0) {
    throw new DiaryFormatError("The ZIP does not contain diary.csv. Use the ZIP from Letterboxd → Settings → Data → Export your data.");
  }
  return decodeText(await candidates[0].async("uint8array"));
}

function parseDate(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return `${y}-${mo}-${d}`;
}

function parseYear(value: string | undefined): number | null {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 1870 && n < 2200 ? n : null;
}

function parseRating(value: string | undefined): number | null {
  const n = Number.parseFloat((value ?? "").trim());
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

export function parseDiaryCsv(text: string): ParsedDiary {
  if (!text.trim()) throw new DiaryFormatError("The file is empty.");

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const fields = parsed.meta.fields ?? [];
  const has = (f: string) => fields.includes(f);

  if (!has("Name") || (!has("Watched Date") && !has("Date"))) {
    throw new DiaryFormatError(
      `This does not look like a Letterboxd diary.csv (found columns: ${fields.slice(0, 8).join(", ") || "none"}). ` +
        "Import diary.csv or the full Letterboxd export ZIP.",
    );
  }
  if (!has("Watched Date")) {
    throw new DiaryFormatError(
      "The file has no “Watched Date” column. Import diary.csv (not watched.csv or ratings.csv) so viewing dates are known.",
    );
  }

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
  };
  for (const err of parsed.errors.slice(0, 10)) {
    warn(`CSV row ${(err.row ?? 0) + 2}: ${err.message}`);
  }

  const hasRewatchColumn = has("Rewatch");
  const occurrences = new Map<string, number>();
  const entries: ParsedEntry[] = [];
  let skipped = 0;

  parsed.data.forEach((row, index) => {
    const line = index + 2;
    const name = (row["Name"] ?? "").trim();
    if (!name) {
      skipped++;
      warn(`Row ${line}: missing film name, skipped.`);
      return;
    }
    let watchedDate = parseDate(row["Watched Date"]);
    if (!watchedDate) {
      watchedDate = parseDate(row["Date"]);
      if (!watchedDate) {
        skipped++;
        warn(`Row ${line} (“${name}”): no valid watched date, skipped.`);
        return;
      }
      warn(`Row ${line} (“${name}”): empty Watched Date, used the logged Date instead.`);
    }

    const releaseYear = parseYear(row["Year"]);
    const letterboxdUri = (row["Letterboxd URI"] ?? "").trim() || null;
    const base = letterboxdUri
      ? `uri:${letterboxdUri}|${watchedDate}`
      : `row:${normalizeTitle(name)}|${releaseYear ?? ""}|${watchedDate}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);

    entries.push({
      id: "e" + sha1(`${base}#${occurrence}`).slice(0, 16),
      filmKey: filmKey(name, releaseYear),
      source: {
        name,
        releaseYear,
        watchedDate,
        loggedDate: parseDate(row["Date"]),
        letterboxdUri,
        rating: parseRating(row["Rating"]),
        rewatch: hasRewatchColumn ? /^(yes|true|1)$/i.test((row["Rewatch"] ?? "").trim()) : null,
        tags: (row["Tags"] ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        importOrder: index,
      },
    });
  });

  if (entries.length === 0) {
    throw new DiaryFormatError("No valid diary entries were found in the file.");
  }

  return { entries, rows: parsed.data.length, skipped, warnings, hasRewatchColumn };
}
