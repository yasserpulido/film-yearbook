import { errorMessage, jsonError } from "@/lib/server/http";
import { DiaryFormatError, extractDiaryCsv, parseDiaryCsv } from "@/lib/server/letterboxd";
import { importDiary } from "@/lib/server/store";

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("Upload a Letterboxd diary.csv or export ZIP.");
  }
  if (!(file instanceof File) || file.size === 0) return jsonError("Choose a diary.csv or Letterboxd export ZIP to import.");
  if (file.size > MAX_BYTES) return jsonError("The file is too large to be a Letterboxd export.");

  try {
    const csv = await extractDiaryCsv(new Uint8Array(await file.arrayBuffer()));
    const diary = parseDiaryCsv(csv);
    return Response.json(await importDiary(diary));
  } catch (error) {
    if (error instanceof DiaryFormatError) return jsonError(error.message, 422);
    return jsonError(`Import failed: ${errorMessage(error)}`, 500);
  }
}
