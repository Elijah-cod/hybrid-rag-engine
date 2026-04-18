import { NextResponse } from "next/server";
import { extractTextFromUploadedFile } from "@/lib/file-extraction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const maybeFile = formData.get("file");

    if (!(maybeFile instanceof File)) {
      return NextResponse.json({ error: "A file upload is required." }, { status: 400 });
    }

    const extracted = await extractTextFromUploadedFile(maybeFile);
    return NextResponse.json(extracted);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
