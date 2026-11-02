import { errorMessage, jsonError, parseEntryIds, parseYear } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, UserInputError, setUploadOverride } from "@/lib/server/overrides";

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Invalid upload.");
  }
  const year = parseYear(form.get("year"));
  let entryIds: string[] | null = null;
  try {
    entryIds = parseEntryIds(JSON.parse(String(form.get("entryIds") ?? "null")));
  } catch {
    /* handled below */
  }
  const file = form.get("file");
  if (!year || !entryIds) return jsonError("Invalid year or diary entry.");
  if (!(file instanceof File)) return jsonError("Choose an image to upload.");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("The image is larger than 60 MB.");

  try {
    await setUploadOverride(year, entryIds, new Uint8Array(await file.arrayBuffer()));
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(errorMessage(error), error instanceof UserInputError ? 422 : 500);
  }
}
