import "server-only";
import type { ProgressEvent } from "@/lib/types";
import { isValidYear } from "./store";

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function parseYear(value: unknown): number | null {
  const year = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return isValidYear(year) ? year : null;
}

export function parseEntryIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.filter((v): v is string => typeof v === "string" && /^e[0-9a-f]{16}$/.test(v));
  return ids.length === value.length ? ids : null;
}

/** Streams progress events as newline-delimited JSON, ending with "done" or "error". */
export function progressStream(run: (emit: (e: ProgressEvent) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          /* client disconnected; keep working so state is still persisted */
        }
      };
      try {
        const result = await run(emit);
        emit({ type: "done", result });
      } catch (error) {
        emit({ type: "error", message: errorMessage(error) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
