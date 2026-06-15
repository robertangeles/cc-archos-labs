import {
  requireOrgContext,
  requireRole,
  orgAuthErrorResponse,
} from "@/lib/auth/org-context";
import * as attachments from "@/lib/contract-attachments/service";
import {
  cloudinaryConfigFromIntegration,
  uploadToCloudinary,
} from "@/lib/cloudinary";

export const runtime = "nodejs";

// Max upload size — 50MB. Matches the Kanban card attachment ceiling; bounded by
// what we buffer in memory before the Cloudinary upload (Cloudinary's own
// per-file limit still applies on their side).
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// GET /api/clients/:id/contracts/:contractId/attachments — list a contract's
// attachments, oldest-first. Any member. Empty when the contract is not in the
// caller's org.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  try {
    const { ctx } = await requireOrgContext(request);
    const { contractId } = await params;
    const list = await attachments.listAttachments(ctx.orgId, contractId);
    return Response.json({ ok: true, attachments: list });
  } catch (err) {
    const r = orgAuthErrorResponse(err);
    if (r) return r;
    throw err;
  }
}

// POST /api/clients/:id/contracts/:contractId/attachments — upload a file
// (multipart form-data, field "file") to Cloudinary and record it on the
// contract. Owner|admin (contracts are managed by owner/admin).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; contractId: string }> },
) {
  try {
    const { auth, ctx } = await requireOrgContext(request, { mutation: true });
    requireRole(ctx, "owner", "admin");
    const { contractId } = await params;

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
        { ok: false, error: "File is too large. The limit is 50MB." },
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
      console.error("[contract attachments POST] cloudinary upload failed:", err);
      return Response.json(
        { ok: false, error: "Upload failed. Please try again." },
        { status: 502 },
      );
    }

    const attachment = await attachments.createAttachment(
      ctx.orgId,
      contractId,
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
        { ok: false, error: "Contract not found" },
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
