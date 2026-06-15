import {
  requireOrgContext,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as attachments from "@/lib/kanban-attachments/service";
import {
  cloudinaryConfigFromIntegration,
  uploadToCloudinary,
} from "@/lib/cloudinary";

export const runtime = "nodejs";

// Max upload size — 10MB. Matches the Next.js App Router body-size practicality
// ceiling and keeps a single card attachment reasonable.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// GET /api/projects/:id/cards/:cardId/attachments — list a card's attachments,
// oldest-first. Any member. Empty when the card is not in the caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { cardId } = await params;
    const list = await attachments.listAttachments(ctx.orgId, cardId);
    return Response.json({ ok: true, attachments: list });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/projects/:id/cards/:cardId/attachments — upload a file (multipart
// form-data, field "file") to Cloudinary and record it on the card. Any member.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; cardId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    const { cardId } = await params;

    // Storage must be configured before we accept an upload.
    const storage = await cloudinaryConfigFromIntegration();
    if (!storage) {
      return Response.json(
        {
          ok: false,
          error:
            "File storage isn't configured. Add Cloudinary in admin settings.",
        },
        { status: 503 },
      );
    }

    // Parse the multipart body. A malformed body throws — treat as bad input.
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json(
        { ok: false, error: "Expected a multipart form upload." },
        { status: 400 },
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { ok: false, error: "No file was provided." },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return Response.json(
        { ok: false, error: "The uploaded file is empty." },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return Response.json(
        { ok: false, error: "File is too large. The limit is 10MB." },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Upload to Cloudinary. A failure here is a storage problem, not a client
    // error — surface a plain message without leaking the raw exception.
    let uploaded;
    try {
      uploaded = await uploadToCloudinary({
        bytes,
        fileName: file.name || "upload",
        mimeType: file.type || "application/octet-stream",
      });
    } catch (err) {
      console.error("[attachments POST] cloudinary upload failed:", err);
      return Response.json(
        { ok: false, error: "Upload failed. Please try again." },
        { status: 502 },
      );
    }

    const attachment = await attachments.createAttachment(
      ctx.orgId,
      cardId,
      {
        fileName: file.name || "upload",
        fileUrl: uploaded.url,
        fileType: file.type || null,
        fileSize: uploaded.bytes,
      },
      auth.user.id,
    );
    if (!attachment) {
      return Response.json(
        { ok: false, error: "Card not found" },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, attachment }, { status: 201 });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}
