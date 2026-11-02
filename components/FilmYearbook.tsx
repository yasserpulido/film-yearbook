"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, postJson, streamProgress } from "@/lib/client";
import { sortByWatched } from "@/lib/layout";
import type { AppState, EntryView, ImportSummary, Orientation, SortOrder, YearStats, YearView } from "@/lib/types";
import { ExportPanel } from "./ExportPanel";
import { PosterEditor } from "./PosterEditor";
import { LargeGrid, PrintSheet } from "./PosterGrid";

type SyncState = { label: string; done: number; total: number } | null;
type Notice = { tone: "info" | "error" | "warn"; text: string; details?: string[] } | null;

const PREFS_KEY = "film-yearbook:prefs";

interface Prefs {
  year?: number;
  order?: SortOrder;
  mode?: "print" | "large";
  orientation?: Orientation;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}

function fmt(n: number, digits = 1) {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function Stat({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div>
      <dd className="text-3xl font-semibold tabular-nums text-neutral-100 sm:text-4xl">{value}</dd>
      <dt className="mt-1 text-[11px] uppercase tracking-[0.14em] text-neutral-500">{label}</dt>
      {note && <p className="mt-0.5 text-[11px] text-neutral-600">{note}</p>}
    </div>
  );
}

function StatsGrid({ stats }: { stats: YearStats }) {
  const hours = stats.runtimeMinutes / 60;
  const runtimeComplete = stats.runtimeKnown === stats.entries;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
      <Stat value={fmt(stats.entries, 0)} label="Diary entries" note={stats.uniqueFilms !== stats.entries ? `${stats.uniqueFilms} unique films` : undefined} />
      <Stat
        value={stats.runtimeKnown ? fmt(hours, hours < 100 ? 1 : 0) : "—"}
        label="Hours watched"
        note={runtimeComplete ? undefined : `runtime known for ${stats.runtimeKnown} of ${stats.entries}`}
      />
      <Stat value={fmt(stats.perMonth)} label="Films per month" note={stats.partialYear ? `over ${stats.daysCovered} days so far` : undefined} />
      <Stat value={fmt(stats.perWeek)} label="Films per week" />
      <Stat
        value={stats.rewatches === null ? "—" : fmt(stats.rewatches, 0)}
        label="Rewatches"
        note={stats.rewatches === null ? "not in this export" : undefined}
      />
    </dl>
  );
}

export function FilmYearbook() {
  const [state, setState] = useState<AppState | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [view, setView] = useState<YearView | null>(null);
  const [order, setOrder] = useState<SortOrder>("desc");
  const [mode, setMode] = useState<"print" | "large">("print");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [sync, setSync] = useState<SyncState>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSynced = useRef(new Set<number>());
  const syncing = useRef(false);
  const prefsLoaded = useRef(false);
  const yearRef = useRef<number | null>(null);

  useEffect(() => {
    yearRef.current = year;
  }, [year]);

  const loadState = useCallback(async (preferYear?: number) => {
    const next = await api<AppState>("/api/state");
    setState(next);
    setYear((current) => {
      const available = next.years.map((y) => y.year);
      const wanted = preferYear ?? current ?? readPrefs().year;
      return wanted && available.includes(wanted) ? wanted : (available[0] ?? null);
    });
    return next;
  }, []);

  const loadView = useCallback(async (y: number) => {
    const next = await api<YearView>(`/api/year?year=${y}`);
    if (yearRef.current === y) setView(next);
    return next;
  }, []);

  useEffect(() => {
    const prefs = readPrefs();
    // Restoring persisted UI preferences from localStorage after hydration.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (prefs.order) setOrder(prefs.order);
    if (prefs.mode) setMode(prefs.mode);
    if (prefs.orientation) setOrientation(prefs.orientation);
    /* eslint-enable react-hooks/set-state-in-effect */
    prefsLoaded.current = true;
    loadState().catch((e: Error) => setLoadError(e.message));
  }, [loadState]);

  useEffect(() => {
    if (!prefsLoaded.current) return;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ year: year ?? undefined, order, mode, orientation } satisfies Prefs));
  }, [year, order, mode, orientation]);

  const runSync = useCallback(
    async (y: number, retry: boolean) => {
      if (syncing.current) return;
      syncing.current = true;
      setSync({ label: "Contacting TMDb", done: 0, total: 0 });
      let lastRefresh = Date.now();
      try {
        const summary = await streamProgress<{ films: number; matched: number; uncertain: number; notFound: number; errors: number; posterFailures: number }>(
          "/api/sync",
          { year: y, retry },
          (e) => {
            if (e.type === "start" || e.type === "progress") {
              setSync({ label: e.label, done: e.type === "progress" ? e.done : 0, total: e.total });
              if (Date.now() - lastRefresh > 2500) {
                lastRefresh = Date.now();
                void loadView(y).catch(() => undefined);
              }
            }
          },
        );
        await loadView(y);
        if (summary.films > 0) {
          const parts = [`${summary.matched} matched`];
          if (summary.uncertain) parts.push(`${summary.uncertain} need review (amber dot)`);
          if (summary.notFound) parts.push(`${summary.notFound} not found`);
          if (summary.errors) parts.push(`${summary.errors} failed — retry later`);
          if (summary.posterFailures) parts.push(`${summary.posterFailures} poster downloads failed`);
          setNotice({ tone: summary.errors || summary.posterFailures ? "warn" : "info", text: `Posters updated for ${summary.films} films: ${parts.join(", ")}.` });
        }
      } catch (e) {
        setNotice({ tone: "error", text: `Poster sync stopped: ${(e as Error).message}` });
        await loadView(y).catch(() => undefined);
      } finally {
        syncing.current = false;
        setSync(null);
      }
    },
    [loadView],
  );

  useEffect(() => {
    if (year === null) return;
    let cancelled = false;
    loadView(year)
      .then((v) => {
        if (cancelled) return;
        setLoadError(null);
        if (state?.tmdbConfigured && v.stats.pending > 0 && !autoSynced.current.has(year)) {
          autoSynced.current.add(year);
          void runSync(year, false);
        }
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, [year, state?.tmdbConfigured, loadView, runSync]);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const summary = await api<ImportSummary>("/api/import", { method: "POST", body: form });
      const added = summary.years.reduce((n, y) => n + y.added, 0);
      const stale = summary.years.reduce((n, y) => n + y.stale, 0);
      summary.years.forEach((y) => y.added > 0 && autoSynced.current.delete(y.year));
      const withEntries = summary.years.filter((y) => y.total > 0).map((y) => y.year);
      const currentYear = new Date().getFullYear();
      const target =
        year !== null && withEntries.includes(year) ? year : withEntries.includes(currentYear) ? currentYear : withEntries[0];
      const nextState = await loadState(target);
      if (target !== undefined) {
        yearRef.current = target;
        const v = await loadView(target);
        if (nextState.tmdbConfigured && v.stats.pending > 0 && !autoSynced.current.has(target)) {
          autoSynced.current.add(target);
          void runSync(target, false);
        }
      }
      setNotice({
        tone: summary.warnings.length ? "warn" : "info",
        text:
          `Imported ${summary.imported} diary entries across ${summary.years.filter((y) => y.total > 0).length} year(s): ${added} new` +
          (stale ? `, ${stale} no longer in this export (kept)` : "") +
          (summary.skipped ? `, ${summary.skipped} rows skipped` : "") +
          ". Existing corrections were preserved.",
        details: summary.warnings,
      });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setImporting(false);
    }
  };

  const pruneStale = async () => {
    if (!year || !view) return;
    if (!window.confirm(`Remove ${view.staleCount} entries that are no longer in your latest Letterboxd export? Their poster corrections will be lost.`)) return;
    try {
      await postJson("/api/year/prune", { year });
      await loadState(year);
      await loadView(year);
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    }
  };

  const entries = useMemo(() => (view ? sortByWatched(view.entries, order) : []), [view, order]);
  const editing = editingId ? (view?.entries.find((e) => e.id === editingId) ?? null) : null;
  const siblings = editing ? entries.filter((e) => e.filmKey === editing.filmKey) : [];
  const selectEntry = useCallback((e: EntryView) => setEditingId(e.id), []);

  const hasData = (state?.years.length ?? 0) > 0;
  const stats = view?.stats;
  const unresolved = stats ? stats.missingPosters : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-5 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <span className="text-xs font-semibold uppercase tracking-[0.25em] text-neutral-500">Film Yearbook</span>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          {hasData && (
            <a href="/api/backup" className="hover:text-neutral-200" title="Download all JSON data and images as a ZIP">
              Backup
            </a>
          )}
          <button type="button" disabled={importing} onClick={() => fileInput.current?.click()} className="hover:text-neutral-200 disabled:opacity-50">
            {importing ? "Importing…" : hasData ? "Import update" : "Import"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.zip,text/csv,application/zip"
            className="hidden"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </header>

      {state && !state.tmdbConfigured && (
        <p className="mt-4 rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-sm text-amber-100">
          TMDb is not configured, so posters and runtimes cannot be fetched. Add <code>TMDB_API_TOKEN</code> to <code>.env.local</code> and restart. You can still
          upload posters manually.
        </p>
      )}

      {notice && (
        <div
          className={`mt-4 rounded border px-3 py-2 text-sm ${
            notice.tone === "error"
              ? "border-rose-900 bg-rose-950/40 text-rose-100"
              : notice.tone === "warn"
                ? "border-amber-900/60 bg-amber-950/20 text-amber-100"
                : "border-neutral-800 bg-neutral-900/60 text-neutral-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p>{notice.text}</p>
            <button type="button" onClick={() => setNotice(null)} className="text-neutral-500 hover:text-neutral-200" aria-label="Dismiss">
              ×
            </button>
          </div>
          {notice.details && notice.details.length > 0 && (
            <details className="mt-1 text-xs text-neutral-400">
              <summary className="cursor-pointer">{notice.details.length} warning(s)</summary>
              <ul className="mt-1 list-disc pl-5">
                {notice.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {loadError && <p className="mt-4 rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{loadError}</p>}

      {!state && !loadError && <p className="mt-24 text-center text-sm text-neutral-600">Loading…</p>}

      {state && !hasData && (
        <section className="mx-auto mt-24 max-w-md text-center">
          <h1 className="text-3xl font-semibold text-neutral-100">Your year in films, printed.</h1>
          <p className="mt-4 text-sm leading-relaxed text-neutral-400">
            Export your data from Letterboxd (Settings → Data → Export your data), then import the ZIP or its <code className="text-neutral-200">diary.csv</code>.
            Everything stays on this computer.
          </p>
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInput.current?.click()}
            className="mt-8 rounded-md bg-white px-6 py-3 font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import Letterboxd export"}
          </button>
        </section>
      )}

      {hasData && year !== null && (
        <>
          <section className="mt-6 border-b border-neutral-900 pb-8">
            <label className="sr-only" htmlFor="year-select">
              Year
            </label>
            <select
              id="year-select"
              value={year}
              onChange={(e) => {
                setNotice(null);
                setYear(Number(e.target.value));
              }}
              className="-ml-1 cursor-pointer appearance-none bg-transparent pr-2 text-6xl font-bold tracking-tight text-white outline-none sm:text-7xl"
            >
              {state!.years.map((y) => (
                <option key={y.year} value={y.year} className="bg-neutral-900 text-base">
                  {y.year}
                </option>
              ))}
            </select>
            <div className="mt-6">{stats && view?.year === year ? <StatsGrid stats={stats} /> : <div className="h-20" />}</div>
          </section>

          <section className="mt-6">
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <div className="flex rounded border border-neutral-800 p-0.5">
                {(["desc", "asc"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOrder(o)}
                    className={`rounded px-2.5 py-1 ${order === o ? "bg-neutral-200 text-black" : "text-neutral-400 hover:text-neutral-100"}`}
                  >
                    {o === "desc" ? "Newest first" : "Oldest first"}
                  </button>
                ))}
              </div>
              <div className="flex rounded border border-neutral-800 p-0.5">
                {(["print", "large"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded px-2.5 py-1 ${mode === m ? "bg-neutral-200 text-black" : "text-neutral-400 hover:text-neutral-100"}`}
                  >
                    {m === "print" ? "Print layout" : "Large posters"}
                  </button>
                ))}
              </div>

              <div className="ml-auto flex items-center gap-3 text-neutral-500">
                {stats && unresolved > 0 && <span>{unresolved} without poster</span>}
                {stats && stats.uncertain > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {stats.uncertain} to review
                  </span>
                )}
                {state?.tmdbConfigured && !sync && (
                  <button type="button" onClick={() => void runSync(year, true)} className="underline hover:text-neutral-200">
                    {stats && (stats.pending > 0 || unresolved > 0) ? "Fetch missing posters" : "Check posters"}
                  </button>
                )}
              </div>
            </div>

            {sync && (
              <div className="mb-4">
                <div className="h-0.5 overflow-hidden bg-neutral-800">
                  <div className="h-full bg-white transition-all" style={{ width: sync.total ? `${(sync.done / sync.total) * 100}%` : "3%" }} />
                </div>
                <p className="mt-1.5 truncate text-xs text-neutral-500">
                  {sync.total ? `Fetching posters ${sync.done}/${sync.total} · ${sync.label}` : sync.label}
                </p>
              </div>
            )}

            {view && view.staleCount > 0 && (
              <p className="mb-4 text-xs text-neutral-500">
                {view.staleCount} entries are no longer in your latest Letterboxd export and were kept.{" "}
                <button type="button" onClick={() => void pruneStale()} className="underline hover:text-neutral-200">
                  Remove them
                </button>
              </p>
            )}

            {view?.year !== year && !loadError && <p className="py-24 text-center text-sm text-neutral-600">Loading {year}…</p>}
            {view?.year === year &&
              (mode === "print" ? (
                <PrintSheet entries={entries} orientation={orientation} year={year} onSelect={selectEntry} />
              ) : (
                <LargeGrid entries={entries} onSelect={selectEntry} />
              ))}
          </section>

          <ExportPanel
            key={`${year}-${orientation}`}
            year={year}
            order={order}
            orientation={orientation}
            onOrientationChange={setOrientation}
            disabled={!view || view.entries.length === 0 || Boolean(sync)}
          />
        </>
      )}

      {editing && year !== null && (
        <PosterEditor
          key={editing.id}
          entry={editing}
          year={year}
          siblings={siblings}
          tmdbConfigured={Boolean(state?.tmdbConfigured)}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            void loadView(year);
          }}
        />
      )}
    </div>
  );
}
