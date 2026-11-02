"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDate, postJson } from "@/lib/client";
import type { EntryView, TmdbCandidate, TmdbPosterOption } from "@/lib/types";

type Pending =
  | { kind: "tmdb"; movie: TmdbCandidate; poster: TmdbPosterOption }
  | { kind: "upload"; file: File; previewUrl: string; width: number; height: number }
  | { kind: "reset" };

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

function statusLabel(entry: EntryView) {
  if (entry.posterSource === "upload") return { text: "Uploaded image", tone: "text-sky-300" };
  if (entry.posterSource === "tmdb-manual") return { text: "Manual TMDb choice", tone: "text-sky-300" };
  switch (entry.matchStatus) {
    case "matched":
      return { text: "Matched automatically", tone: "text-emerald-300" };
    case "uncertain":
      return { text: "Uncertain match — please confirm", tone: "text-amber-300" };
    case "not_found":
      return { text: "Not found on TMDb", tone: "text-rose-300" };
    case "error":
      return { text: "TMDb lookup failed", tone: "text-rose-300" };
    default:
      return { text: "Not looked up yet", tone: "text-neutral-400" };
  }
}

export function PosterEditor({
  entry,
  year,
  siblings,
  tmdbConfigured,
  onClose,
  onSaved,
}: {
  entry: EntryView;
  year: number;
  siblings: EntryView[];
  tmdbConfigured: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"tmdb" | "upload">(tmdbConfigured ? "tmdb" : "upload");
  const [query, setQuery] = useState(entry.name);
  const [searchYear, setSearchYear] = useState(String(entry.releaseYear ?? ""));
  const [results, setResults] = useState<TmdbCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [movie, setMovie] = useState<TmdbCandidate | null>(null);
  const [posters, setPosters] = useState<TmdbPosterOption[] | null>(null);
  const [loadingPosters, setLoadingPosters] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [applyAll, setApplyAll] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const search = useCallback(async (q: string, y: string) => {
    if (!q.trim()) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (/^\d{4}$/.test(y.trim())) params.set("year", y.trim());
      const data = await api<{ results: TmdbCandidate[] }>(`/api/tmdb/search?${params}`);
      if (seq === searchSeq.current) setResults(data.results);
    } catch (e) {
      if (seq === searchSeq.current) {
        setResults([]);
        setError((e as Error).message);
      }
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  const chooseMovie = useCallback(async (candidate: TmdbCandidate) => {
    setMovie(candidate);
    setPosters(null);
    setLoadingPosters(true);
    setError(null);
    try {
      const data = await api<{ posters: TmdbPosterOption[] }>(`/api/tmdb/posters?id=${candidate.id}`);
      setPosters(data.posters);
      const first = data.posters[0];
      if (first) setPending({ kind: "tmdb", movie: candidate, poster: first });
      else setError("TMDb has no posters for this film. Upload an image instead.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingPosters(false);
    }
  }, []);

  useEffect(() => {
    // Initial lookup; the async search only sets state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tmdbConfigured) void search(query, searchYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  useEffect(() => {
    if (pending?.kind !== "upload") return;
    const url = pending.previewUrl;
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!ACCEPTED.includes(file.type)) {
      setError("Unsupported file type. Use a JPEG, PNG or WebP image.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setPending({ kind: "upload", file, previewUrl, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      setError("This image could not be read. It may be corrupted.");
    };
    img.src = previewUrl;
  };

  const targetIds = applyAll ? siblings.map((s) => s.id) : [entry.id];

  const save = async () => {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      if (pending.kind === "tmdb") {
        await postJson("/api/override", { year, entryIds: targetIds, tmdbId: pending.movie.id, posterPath: pending.poster.filePath });
      } else if (pending.kind === "upload") {
        const form = new FormData();
        form.set("year", String(year));
        form.set("entryIds", JSON.stringify(targetIds));
        form.set("file", pending.file);
        await api("/api/override/upload", { method: "POST", body: form });
      } else {
        await postJson("/api/override", { year, entryIds: targetIds }, "DELETE");
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const preview =
    pending?.kind === "tmdb"
      ? pending.poster.thumbUrl
      : pending?.kind === "upload"
        ? pending.previewUrl
        : pending?.kind === "reset"
          ? null
          : entry.posterUrl
            ? `${entry.posterUrl}&w=540`
            : null;
  const status = statusLabel(entry);
  const tmdbLink = entry.tmdb ? `https://www.themoviedb.org/movie/${entry.tmdb.id}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-title"
    >
      <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:grid-cols-[220px_1fr] sm:p-6">
          <div className="space-y-3">
            <div className="relative aspect-[2/3] w-full max-w-[220px] overflow-hidden bg-[#151515]">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Poster preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs uppercase text-neutral-500">
                  {pending?.kind === "reset" ? "Automatic TMDb poster" : "No poster"}
                </div>
              )}
              {pending && (
                <span className="absolute left-2 top-2 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase text-black">
                  Unsaved
                </span>
              )}
            </div>
            {pending?.kind === "upload" && (
              <p className="text-xs text-neutral-400">
                {pending.width} × {pending.height} px · {(pending.file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            {pending?.kind === "tmdb" && pending.poster.width > 0 && (
              <p className="text-xs text-neutral-400">
                {pending.poster.width} × {pending.poster.height} px (original)
              </p>
            )}
            {!pending && entry.posterWidth && (
              <p className="text-xs text-neutral-500">
                Current: {entry.posterWidth} × {entry.posterHeight} px
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-5">
            <div>
              <h2 id="editor-title" className="text-xl font-semibold text-neutral-100">
                {entry.name} <span className="font-normal text-neutral-500">{entry.releaseYear ?? ""}</span>
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                Watched {formatDate(entry.watchedDate)}
                {entry.rewatch ? " · rewatch" : ""}
                {entry.rating !== null ? ` · ${entry.rating}★` : ""}
                {entry.letterboxdUri && (
                  <>
                    {" · "}
                    <a href={entry.letterboxdUri} target="_blank" rel="noreferrer" className="underline hover:text-white">
                      Letterboxd
                    </a>
                  </>
                )}
              </p>
              <p className="mt-2 text-sm">
                <span className={status.tone}>{status.text}</span>
                {entry.tmdb && tmdbLink && (
                  <span className="text-neutral-400">
                    {" · "}
                    <a href={tmdbLink} target="_blank" rel="noreferrer" className="underline hover:text-white">
                      TMDb #{entry.tmdb.id}
                    </a>{" "}
                    {entry.tmdb.title} {entry.tmdb.releaseYear ? `(${entry.tmdb.releaseYear})` : ""}
                    {entry.tmdb.runtime ? ` · ${entry.tmdb.runtime} min` : ""}
                  </span>
                )}
              </p>
              {entry.matchMessage && !entry.hasOverride && <p className="mt-1 text-xs text-neutral-500">{entry.matchMessage}</p>}
            </div>

            <div className="flex gap-1 border-b border-neutral-800 text-sm">
              {(["tmdb", "upload"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? "border-white text-white" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
                >
                  {t === "tmdb" ? "Search TMDb" : "Upload image"}
                </button>
              ))}
            </div>

            {tab === "tmdb" &&
              (tmdbConfigured ? (
                <div className="space-y-4">
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setMovie(null);
                      setPosters(null);
                      void search(query, searchYear);
                    }}
                  >
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Title, TMDb ID or themoviedb.org URL"
                      className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-400"
                    />
                    <input
                      value={searchYear}
                      onChange={(e) => setSearchYear(e.target.value)}
                      placeholder="Year"
                      inputMode="numeric"
                      className="w-20 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-400"
                    />
                    <button type="submit" className="rounded bg-neutral-200 px-4 py-2 text-sm font-medium text-black hover:bg-white">
                      {searching ? "Searching…" : "Search"}
                    </button>
                  </form>

                  {!movie && results && (
                    <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                      {results.length === 0 && !searching && <li className="text-sm text-neutral-500">No results. Try another title or remove the year.</li>}
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => void chooseMovie(r)}
                            className="flex w-full items-center gap-3 rounded p-1.5 text-left hover:bg-neutral-900"
                          >
                            <span className="block h-[54px] w-9 shrink-0 overflow-hidden bg-neutral-800">
                              {r.thumbUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-neutral-100">
                                {r.title} <span className="text-neutral-500">{r.releaseYear ?? ""}</span>
                              </span>
                              <span className="block truncate text-xs text-neutral-500">
                                {r.originalTitle ? `${r.originalTitle} · ` : ""}TMDb #{r.id}
                                {entry.tmdb?.id === r.id ? " · current" : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {movie && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-neutral-200">
                          Posters for <strong>{movie.title}</strong> {movie.releaseYear ? `(${movie.releaseYear})` : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setMovie(null);
                            setPosters(null);
                            setPending(null);
                          }}
                          className="shrink-0 text-xs text-neutral-400 underline hover:text-white"
                        >
                          Back to results
                        </button>
                      </div>
                      {loadingPosters && <p className="text-sm text-neutral-500">Loading posters…</p>}
                      {posters && (
                        <div className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
                          {posters.map((p) => {
                            const selected = pending?.kind === "tmdb" && pending.poster.filePath === p.filePath;
                            return (
                              <button
                                key={p.filePath}
                                type="button"
                                onClick={() => setPending({ kind: "tmdb", movie, poster: p })}
                                title={`${p.width}×${p.height}${p.language ? ` · ${p.language}` : ""}${p.primary ? " · default" : ""}`}
                                className={`relative aspect-[2/3] overflow-hidden bg-neutral-800 ${selected ? "ring-2 ring-white" : "opacity-80 hover:opacity-100"}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                {p.language && (
                                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] uppercase text-neutral-300">
                                    {p.language}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-neutral-400">
                  TMDb is not configured. Add <code className="text-neutral-200">TMDB_API_TOKEN</code> to <code className="text-neutral-200">.env.local</code>{" "}
                  and restart the app, or upload an image instead.
                </p>
              ))}

            {tab === "upload" && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pickFile(e.dataTransfer.files[0]);
                }}
                className={`flex flex-col items-center justify-center gap-3 rounded border border-dashed px-4 py-10 text-center text-sm ${dragging ? "border-white bg-neutral-900" : "border-neutral-700"}`}
              >
                <p className="text-neutral-300">Drop a JPEG, PNG or WebP poster here</p>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="rounded border border-neutral-600 px-3 py-1.5 text-neutral-200 hover:border-neutral-300"
                >
                  Choose file…
                </button>
                <p className="text-xs text-neutral-500">The original file is stored unmodified for print quality. Aim for at least 1000 px wide.</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept={ACCEPTED.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    pickFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            {siblings.length > 1 && (
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="accent-white" />
                Apply to all {siblings.length} viewings of this film in {year}
              </label>
            )}

            {error && <p className="rounded border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 px-4 py-3 sm:px-6">
          {entry.hasOverride && (
            <button
              type="button"
              disabled={saving}
              onClick={() => setPending({ kind: "reset" })}
              className="text-sm text-neutral-400 underline hover:text-white disabled:opacity-50"
            >
              Reset to automatic TMDb poster
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-400 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!pending || saving}
              onClick={() => void save()}
              className="rounded bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
