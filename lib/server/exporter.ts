import "server-only";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  CELL_BACKGROUND,
  DPI,
  PAGE_BACKGROUND,
  computeLayout,
  mmToPt,
  pageMm,
  sortByWatched,
  subtitleText,
} from "@/lib/layout";
import type { ExportResult, Orientation, PreflightReport, ProgressEvent, SortOrder, StoredEntry } from "@/lib/types";
import { loadYear } from "./store";
import { DIRS, dataPath, ensureDir, fileExists, writeFileAtomic } from "./storage";
import { effectivePoster } from "./view";

const LOW_DPI = 200;
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const exporting = ((globalThis as unknown as { __fyExports?: Set<string> }).__fyExports ??= new Set());

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

async function orderedEntries(year: number, order: SortOrder) {
  const file = await loadYear(year);
  if (!file || file.entries.length === 0) throw new Error(`No diary entries for ${year}. Import your Letterboxd diary first.`);
  const sorted = sortByWatched(
    file.entries.map((e) => ({ id: e.id, watchedDate: e.source.watchedDate, importOrder: e.source.importOrder, entry: e })),
    order,
  );
  return sorted.map((s) => s.entry);
}

async function availablePoster(entry: StoredEntry) {
  const { poster } = effectivePoster(entry);
  if (!poster) return null;
  return (await fileExists(dataPath(poster.file))) ? poster : null;
}

export async function preflight(year: number, orientation: Orientation): Promise<PreflightReport> {
  const entries = await orderedEntries(year, "desc");
  const layout = computeLayout(entries.length, orientation);
  const report: PreflightReport = {
    year,
    orientation,
    count: entries.length,
    width: layout.width,
    height: layout.height,
    cols: layout.cols,
    rows: layout.rows,
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    missing: [],
    uncertain: [],
    lowRes: [],
  };
  for (const e of entries) {
    const poster = await availablePoster(e);
    const item = { id: e.id, name: e.source.name };
    if (!poster) {
      report.missing.push(item);
      continue;
    }
    if (!e.override && e.match?.status === "uncertain") report.uncertain.push(item);
    const dpi = Math.round(DPI * Math.min(poster.width / layout.cellWidth, poster.height / layout.cellHeight));
    if (dpi < LOW_DPI) report.lowRes.push({ ...item, dpi });
  }
  return report;
}

function wrapTitle(title: string, maxChars: number, maxLines: number) {
  const words = title.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,1}$/, "…");
  }
  return lines.map((l) => (l.length > maxChars + 2 ? l.slice(0, maxChars) + "…" : l));
}

function placeholderSvg(w: number, h: number, title: string, year: number | null) {
  const size = Math.max(10, Math.round(w * 0.085));
  const lines = wrapTitle(title.toUpperCase(), 13, 5);
  const lineHeight = size * 1.25;
  const startY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  const stroke = Math.max(2, Math.round(w * 0.012));
  const texts = lines
    .map((l, i) => `<text x="${w / 2}" y="${startY + i * lineHeight}" text-anchor="middle" dominant-baseline="middle">${escapeXml(l)}</text>`)
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="#1a1a1a"/>` +
      `<rect x="${stroke / 2}" y="${stroke / 2}" width="${w - stroke}" height="${h - stroke}" fill="none" stroke="#303030" stroke-width="${stroke}"/>` +
      `<g font-family="${FONT}" font-weight="700" font-size="${size}" fill="#8c8c8c" letter-spacing="${size * 0.04}">${texts}</g>` +
      (year
        ? `<text x="${w / 2}" y="${h - size * 1.6}" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(size * 0.8)}" fill="#5c5c5c">${year}</text>`
        : "") +
      `</svg>`,
  );
}

async function renderCell(entry: StoredEntry, w: number, h: number): Promise<Buffer> {
  const poster = await availablePoster(entry);
  if (poster) {
    try {
      const abs = dataPath(poster.file);
      const meta = await sharp(abs).metadata();
      const pw = meta.autoOrient?.width ?? meta.width ?? w;
      const ph = meta.autoOrient?.height ?? meta.height ?? h;
      const nearPosterRatio = Math.abs(ph / pw - h / w) / (h / w) <= 0.04;
      return await sharp(abs, { failOn: "none" })
        .rotate()
        .resize(w, h, { fit: nearPosterRatio ? "cover" : "contain", position: "centre", background: CELL_BACKGROUND })
        .flatten({ background: CELL_BACKGROUND })
        .toColourspace("srgb")
        .png({ compressionLevel: 1 })
        .toBuffer();
    } catch {
      /* fall through to placeholder */
    }
  }
  return sharp(placeholderSvg(w, h, entry.source.name, entry.source.releaseYear)).png({ compressionLevel: 1 }).toBuffer();
}

function headerSvg(width: number, height: number, year: number, count: number, layout: ReturnType<typeof computeLayout>) {
  const { title, subtitle } = layout;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="${width / 2}" y="${title.baseline}" text-anchor="middle" font-family="${FONT}" font-weight="700" ` +
      `font-size="${title.fontSize}" letter-spacing="${Math.round(title.fontSize * 0.02)}" fill="#f2f2f2">${year}</text>` +
      `<text x="${width / 2 + subtitle.letterSpacing / 2}" y="${subtitle.baseline}" text-anchor="middle" font-family="${FONT}" font-weight="600" ` +
      `font-size="${subtitle.fontSize}" letter-spacing="${subtitle.letterSpacing}" fill="#9d9d9d">${escapeXml(subtitleText(count))}</text>` +
      `</svg>`,
  );
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

export function exportFileName(year: number, orientation: Orientation, ext: "png" | "pdf") {
  return `film-yearbook-${year}-A1-${orientation}.${ext}`;
}

export async function generateExport(
  year: number,
  orientation: Orientation,
  order: SortOrder,
  emit: (e: ProgressEvent) => void,
): Promise<ExportResult> {
  const key = `${year}-${orientation}`;
  if (exporting.size > 0) throw new Error("Another export is already running. Wait for it to finish.");
  exporting.add(key);
  const started = Date.now();
  try {
    const entries = await orderedEntries(year, order);
    const layout = computeLayout(entries.length, orientation);
    if (layout.cellWidth < 20) throw new Error("Too many films to fit legibly on an A1 sheet.");

    emit({ type: "start", total: entries.length, label: "Preparing posters" });
    let done = 0;
    const cells = await mapPool(entries, 4, async (entry) => {
      const buffer = await renderCell(entry, layout.cellWidth, layout.cellHeight);
      done++;
      if (done % 5 === 0 || done === entries.length) emit({ type: "progress", done, total: entries.length, label: "Preparing posters" });
      return buffer;
    });

    await ensureDir(DIRS.exports);
    const pngName = exportFileName(year, orientation, "png");
    const pdfName = exportFileName(year, orientation, "pdf");
    const pngPath = dataPath(`${DIRS.exports}/${pngName}`);
    const pdfPath = dataPath(`${DIRS.exports}/${pdfName}`);
    const tmpPng = `${pngPath}.${process.pid}.tmp.png`;

    emit({ type: "progress", done: entries.length, total: entries.length, label: "Composing full-resolution PNG" });
    const headerHeight = layout.subtitle.baseline + layout.subtitle.fontSize;
    await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: PAGE_BACKGROUND } })
      .composite([
        { input: headerSvg(layout.width, headerHeight, year, entries.length, layout), top: 0, left: 0 },
        ...cells.map((input, i) => ({ input, left: layout.cells[i].x, top: layout.cells[i].y })),
      ])
      .withMetadata({ density: DPI })
      .png({ compressionLevel: 6 })
      .toFile(tmpPng);
    cells.length = 0;
    await fs.rm(pngPath, { force: true });
    await fs.rename(tmpPng, pngPath);

    emit({ type: "progress", done: entries.length, total: entries.length, label: "Writing A1 PDF" });
    const jpeg = await sharp(pngPath, { limitInputPixels: false })
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .withMetadata({ density: DPI })
      .toBuffer();
    const mm = pageMm(orientation);
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${year} — ${subtitleText(entries.length)}`);
    pdf.setCreator("Film Yearbook");
    pdf.setProducer("Film Yearbook (pdf-lib)");
    const image = await pdf.embedJpg(jpeg);
    const page = pdf.addPage([mmToPt(mm.width), mmToPt(mm.height)]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
    await writeFileAtomic(pdfPath, await pdf.save());

    const [pngStat, pdfStat] = await Promise.all([fs.stat(pngPath), fs.stat(pdfPath)]);
    return {
      png: { name: pngName, bytes: pngStat.size },
      pdf: { name: pdfName, bytes: pdfStat.size },
      width: layout.width,
      height: layout.height,
      widthMm: mm.width,
      heightMm: mm.height,
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
  } finally {
    exporting.delete(key);
  }
}
