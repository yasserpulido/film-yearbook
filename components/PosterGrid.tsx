"use client";

import { useMemo } from "react";
import { PAGE_BACKGROUND, computeLayout, subtitleText } from "@/lib/layout";
import type { EntryView, Orientation } from "@/lib/types";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const PREVIEW_WIDTHS = [160, 240, 360, 540];

function previewSrc(url: string, cssWidth: number) {
  const target = cssWidth * 2;
  const w = PREVIEW_WIDTHS.find((x) => x >= target) ?? PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1];
  return `${url}&w=${w}`;
}

function tileLabel(e: EntryView) {
  const parts = [e.name + (e.releaseYear ? ` (${e.releaseYear})` : ""), e.watchedDate];
  if (e.rewatch) parts.push("rewatch");
  if (!e.posterUrl) parts.push("no poster");
  else if (e.matchStatus === "uncertain" && !e.hasOverride) parts.push("match needs review");
  return parts.join(" · ");
}

function Tile({
  entry,
  cssWidth,
  onSelect,
  compact,
}: {
  entry: EntryView;
  cssWidth: number;
  onSelect: (e: EntryView) => void;
  compact: boolean;
}) {
  const needsReview = entry.matchStatus === "uncertain" && !entry.hasOverride && entry.posterUrl;
  return (
    <button
      type="button"
      title={tileLabel(entry)}
      aria-label={`Edit poster: ${tileLabel(entry)}`}
      onClick={() => onSelect(entry)}
      className="group relative block h-full w-full overflow-hidden bg-[#151515] outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {entry.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewSrc(entry.posterUrl, cssWidth)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover transition-opacity group-hover:opacity-80"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center border border-neutral-800 bg-[#1a1a1a] p-[6%] text-center font-semibold uppercase leading-tight text-neutral-500"
          style={{ fontSize: compact ? "clamp(4px, 0.85cqw, 11px)" : "11px", fontFamily: FONT }}
        >
          {entry.name}
        </span>
      )}
      {needsReview && <span className="absolute right-[6%] top-[4%] h-[7%] max-h-2 min-h-1 aspect-square rounded-full bg-amber-400" />}
      <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-transparent group-hover:ring-white/70" />
    </button>
  );
}

export function PrintSheet({
  entries,
  orientation,
  year,
  onSelect,
}: {
  entries: EntryView[];
  orientation: Orientation;
  year: number;
  onSelect: (e: EntryView) => void;
}) {
  const layout = useMemo(() => computeLayout(entries.length, orientation), [entries.length, orientation]);
  const maxWidth = orientation === "portrait" ? 920 : 1300;
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const cqw = (px: number) => `${(px / layout.width) * 100}cqw`;
  const cellCss = (layout.cellWidth / layout.width) * maxWidth;

  return (
    <div
      className="relative mx-auto w-full shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
      style={{ maxWidth, aspectRatio: `${layout.width} / ${layout.height}`, background: PAGE_BACKGROUND, containerType: "inline-size" }}
    >
      <div
        className="absolute inset-x-0 text-center font-bold text-neutral-100"
        style={{
          top: pct(layout.title.baseline - layout.title.fontSize * 0.85, layout.height),
          fontSize: cqw(layout.title.fontSize),
          lineHeight: 1,
          letterSpacing: cqw(layout.title.fontSize * 0.02),
          fontFamily: FONT,
        }}
      >
        {year}
      </div>
      <div
        className="absolute inset-x-0 text-center font-semibold text-neutral-400"
        style={{
          top: pct(layout.subtitle.baseline - layout.subtitle.fontSize * 0.85, layout.height),
          fontSize: cqw(layout.subtitle.fontSize),
          lineHeight: 1,
          letterSpacing: cqw(layout.subtitle.letterSpacing),
          paddingLeft: cqw(layout.subtitle.letterSpacing),
          fontFamily: FONT,
        }}
      >
        {subtitleText(entries.length)}
      </div>
      {entries.map((entry, i) => {
        const cell = layout.cells[i];
        return (
          <div
            key={entry.id}
            className="absolute"
            style={{
              left: pct(cell.x, layout.width),
              top: pct(cell.y, layout.height),
              width: pct(layout.cellWidth, layout.width),
              height: pct(layout.cellHeight, layout.height),
            }}
          >
            <Tile entry={entry} cssWidth={cellCss} onSelect={onSelect} compact />
          </div>
        );
      })}
    </div>
  );
}

export function LargeGrid({ entries, onSelect }: { entries: EntryView[]; onSelect: (e: EntryView) => void }) {
  return (
    <div className="grid gap-2 bg-[#0a0a0a] p-2 [grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]">
      {entries.map((entry) => (
        <div key={entry.id} className="aspect-[2/3]">
          <Tile entry={entry} cssWidth={130} onSelect={onSelect} compact={false} />
        </div>
      ))}
    </div>
  );
}
