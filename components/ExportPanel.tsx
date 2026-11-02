"use client";

import { useState } from "react";
import { api, formatBytes, streamProgress } from "@/lib/client";
import type { ExportResult, Orientation, PreflightReport, SortOrder } from "@/lib/types";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirm"; report: PreflightReport }
  | { kind: "running"; label: string; done: number; total: number }
  | { kind: "done"; result: ExportResult }
  | { kind: "error"; message: string };

function hasWarnings(r: PreflightReport) {
  return r.missing.length > 0 || r.uncertain.length > 0 || r.lowRes.length > 0;
}

function NameList({ items }: { items: { id: string; name: string; dpi?: number }[] }) {
  const shown = items.slice(0, 12);
  return (
    <p className="mt-1 text-xs text-neutral-400">
      {shown.map((i) => (i.dpi ? `${i.name} (${i.dpi} DPI)` : i.name)).join(", ")}
      {items.length > shown.length ? ` and ${items.length - shown.length} more` : ""}
    </p>
  );
}

export function ExportPanel({
  year,
  order,
  orientation,
  onOrientationChange,
  disabled,
}: {
  year: number;
  order: SortOrder;
  orientation: Orientation;
  onOrientationChange: (o: Orientation) => void;
  disabled: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "checking" || phase.kind === "running";

  const run = async () => {
    setPhase({ kind: "running", label: "Starting", done: 0, total: 0 });
    try {
      const result = await streamProgress<ExportResult>("/api/export", { year, orientation, order }, (e) => {
        if (e.type === "start" || e.type === "progress") {
          setPhase({ kind: "running", label: e.label, done: e.type === "progress" ? e.done : 0, total: e.total });
        }
      });
      setPhase({ kind: "done", result });
    } catch (e) {
      setPhase({ kind: "error", message: `Export failed: ${(e as Error).message}` });
    }
  };

  const start = async () => {
    setPhase({ kind: "checking" });
    try {
      const report = await api<PreflightReport>(`/api/export/preflight?year=${year}&orientation=${orientation}`);
      if (hasWarnings(report)) setPhase({ kind: "confirm", report });
      else await run();
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  };

  return (
    <section className="mt-10 flex flex-col items-center gap-4 pb-16">
      <div className="flex items-center gap-1 rounded border border-neutral-800 p-0.5 text-xs">
        {(["portrait", "landscape"] as const).map((o) => (
          <button
            key={o}
            type="button"
            disabled={busy}
            onClick={() => onOrientationChange(o)}
            className={`rounded px-3 py-1 ${orientation === o ? "bg-neutral-200 text-black" : "text-neutral-400 hover:text-neutral-100"}`}
          >
            A1 {o === "portrait" ? "portrait" : "landscape"}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => void start()}
        className="rounded-md bg-white px-10 py-4 text-lg font-semibold tracking-wide text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {phase.kind === "checking" ? "Checking posters…" : phase.kind === "running" ? "Generating…" : "Generate Image"}
      </button>
      <p className="text-xs text-neutral-500">
        {orientation === "portrait" ? "594 × 841 mm · 7016 × 9933 px" : "841 × 594 mm · 9933 × 7016 px"} · 300 DPI · PNG + PDF
      </p>

      {phase.kind === "running" && (
        <div className="w-full max-w-md">
          <div className="h-1 overflow-hidden rounded bg-neutral-800">
            <div
              className="h-full bg-white transition-all"
              style={{ width: phase.total ? `${(phase.done / phase.total) * 100}%` : "5%" }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-neutral-400">
            {phase.label}
            {phase.total ? ` · ${phase.done}/${phase.total}` : ""}
          </p>
        </div>
      )}

      {phase.kind === "confirm" && (
        <div className="w-full max-w-xl rounded border border-amber-900/70 bg-amber-950/20 p-4 text-sm text-neutral-200">
          <p className="font-medium text-amber-200">Some posters may not print well:</p>
          {phase.report.missing.length > 0 && (
            <div className="mt-3">
              <p>{phase.report.missing.length} without a poster (a placeholder with the title will be printed).</p>
              <NameList items={phase.report.missing} />
            </div>
          )}
          {phase.report.uncertain.length > 0 && (
            <div className="mt-3">
              <p>{phase.report.uncertain.length} uncertain TMDb match(es) not yet confirmed.</p>
              <NameList items={phase.report.uncertain} />
            </div>
          )}
          {phase.report.lowRes.length > 0 && (
            <div className="mt-3">
              <p>
                {phase.report.lowRes.length} poster(s) below 200 DPI at the printed size ({phase.report.cellWidth} × {phase.report.cellHeight} px per
                poster).
              </p>
              <NameList items={phase.report.lowRes} />
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPhase({ kind: "idle" })}
              className="rounded border border-neutral-700 px-4 py-1.5 text-neutral-200 hover:border-neutral-400"
            >
              Cancel
            </button>
            <button type="button" onClick={() => void run()} className="rounded bg-white px-4 py-1.5 font-semibold text-black hover:bg-neutral-200">
              Generate anyway
            </button>
          </div>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="flex flex-col items-center gap-2 text-sm">
          <p className="text-neutral-300">
            Ready in {phase.result.seconds}s · {phase.result.width} × {phase.result.height} px · {phase.result.widthMm} × {phase.result.heightMm} mm
          </p>
          <div className="flex gap-2">
            <a
              href={`/api/export/file?name=${encodeURIComponent(phase.result.png.name)}`}
              className="rounded border border-neutral-600 px-4 py-2 text-neutral-100 hover:border-white"
            >
              Download PNG ({formatBytes(phase.result.png.bytes)})
            </a>
            <a
              href={`/api/export/file?name=${encodeURIComponent(phase.result.pdf.name)}`}
              className="rounded border border-neutral-600 px-4 py-2 text-neutral-100 hover:border-white"
            >
              Download PDF ({formatBytes(phase.result.pdf.bytes)})
            </a>
          </div>
          <p className="text-xs text-neutral-500">Also saved in data/exports/</p>
        </div>
      )}

      {phase.kind === "error" && (
        <p className="max-w-xl rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{phase.message}</p>
      )}
    </section>
  );
}
