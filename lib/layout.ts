import type { Orientation, SortOrder } from "./types";

export const DPI = 300;
export const POSTER_RATIO = 1.5;
export const A1_MM = { width: 594, height: 841 } as const;
export const PAGE_BACKGROUND = "#0a0a0a";
export const CELL_BACKGROUND = "#151515";

export const mmToPx = (mm: number) => Math.round((mm / 25.4) * DPI);
export const mmToPt = (mm: number) => (mm / 25.4) * 72;

export function pageMm(orientation: Orientation) {
  return orientation === "portrait"
    ? { width: A1_MM.width, height: A1_MM.height }
    : { width: A1_MM.height, height: A1_MM.width };
}

export function pagePx(orientation: Orientation) {
  const mm = pageMm(orientation);
  return { width: mmToPx(mm.width), height: mmToPx(mm.height) };
}

export interface SheetLayout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  gutter: number;
  title: { fontSize: number; baseline: number };
  subtitle: { fontSize: number; baseline: number; letterSpacing: number };
  cells: { x: number; y: number }[];
}

const CAP_HEIGHT = 0.72;

/**
 * Computes the print composition in pixels. The same function drives the
 * on-screen preview (scaled to percentages) and the Sharp export.
 */
export function computeLayout(count: number, orientation: Orientation): SheetLayout {
  const { width, height } = pagePx(orientation);
  const base = Math.min(width, height);
  const margin = mmToPx(30);
  const titleSize = Math.round(base * 0.05);
  const subtitleSize = Math.round(base * 0.0145);
  const titleGap = Math.round(subtitleSize * 1.1);
  const headerGap = Math.round(base * 0.032);
  const titleCap = titleSize * CAP_HEIGHT;
  const subtitleCap = subtitleSize * CAP_HEIGHT;
  const headerHeight = Math.round(titleCap + titleGap + subtitleCap + headerGap);

  const availW = width - margin * 2;
  const availH = height - margin * 2 - headerHeight;

  let best = { cols: 0, rows: 0, w: 0, g: 0 };
  const minGutter = mmToPx(1);
  const maxGutter = mmToPx(5);
  const gutterRatio = 0.055;

  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(count / cols);
    if (rows === 0) break;
    const approx = Math.min(
      availW / (cols + (cols - 1) * gutterRatio),
      availH / (rows * POSTER_RATIO + (rows - 1) * gutterRatio),
    );
    const g = Math.min(maxGutter, Math.max(minGutter, Math.round(approx * gutterRatio)));
    const w = Math.floor(Math.min((availW - (cols - 1) * g) / cols, (availH - (rows - 1) * g) / (rows * POSTER_RATIO)));
    const emptyCells = cols * rows - count;
    const bestEmpty = best.cols * best.rows - count;
    if (w > best.w || (w === best.w && emptyCells < bestEmpty)) best = { cols, rows, w, g };
  }

  const cellWidth = Math.max(0, best.w);
  const cellHeight = Math.round(cellWidth * POSTER_RATIO);
  const gutter = best.g;
  const gridW = best.cols * cellWidth + Math.max(0, best.cols - 1) * gutter;
  const gridH = best.rows * cellHeight + Math.max(0, best.rows - 1) * gutter;

  const blockH = headerHeight + gridH;
  const top = Math.round(margin + (height - margin * 2 - blockH) / 2);
  const gridTop = top + headerHeight;
  const gridLeft = Math.round((width - gridW) / 2);

  const cells: { x: number; y: number }[] = [];
  const lastRowCount = count - (best.rows - 1) * best.cols;
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / best.cols);
    const col = i % best.cols;
    const offset = row === best.rows - 1 ? ((best.cols - lastRowCount) * (cellWidth + gutter)) / 2 : 0;
    cells.push({
      x: Math.round(gridLeft + offset + col * (cellWidth + gutter)),
      y: gridTop + row * (cellHeight + gutter),
    });
  }

  return {
    width,
    height,
    cols: best.cols,
    rows: best.rows,
    cellWidth,
    cellHeight,
    gutter,
    title: { fontSize: titleSize, baseline: Math.round(top + titleCap) },
    subtitle: {
      fontSize: subtitleSize,
      baseline: Math.round(top + titleCap + titleGap + subtitleCap),
      letterSpacing: Math.round(subtitleSize * 0.32),
    },
    cells,
  };
}

export function subtitleText(count: number) {
  return `${count} ${count === 1 ? "FILM" : "FILMS"} WATCHED`;
}

/** Sorts by watched date; equal dates keep the original import order. */
export function sortByWatched<T extends { watchedDate: string; importOrder: number; id: string }>(
  entries: T[],
  order: SortOrder,
): T[] {
  return [...entries].sort((a, b) => {
    const byDate = order === "desc" ? b.watchedDate.localeCompare(a.watchedDate) : a.watchedDate.localeCompare(b.watchedDate);
    return byDate || a.importOrder - b.importOrder || a.id.localeCompare(b.id);
  });
}
