"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

interface KnowledgeDoc {
  id: string;
  title: string;
  sourceType: string;
  category: string | null;
  status: string;
  chunkCount: number;
  lastError: string | null;
  createdAt: string;
}

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "processing"; documentId: string }
  | { kind: "success"; documentId: string }
  | { kind: "error"; message: string };

export default function AdminKnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState<UploadStatus>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("dmbok");
  const [textContent, setTextContent] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/knowledge");
      if (!res.ok) {
        const text = await res.text();
        setLoadError(`API returned ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      const data = await res.json();
      setDocuments(data.documents ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to fetch documents");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  useEffect(() => {
    if (upload.kind !== "processing") return;
    const interval = setInterval(async () => {
      await fetchDocuments();
      const doc = documents.find((d) => d.id === (upload as { documentId: string }).documentId);
      if (doc && doc.status !== "processing") {
        setUpload(
          doc.status === "ready"
            ? { kind: "success", documentId: doc.id }
            : { kind: "error", message: doc.lastError ?? "Ingestion failed" },
        );
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [upload, documents, fetchDocuments]);

  async function extractPdfText(file: File): Promise<string> {
    // pdf.js is BUNDLED, not fetched, and loaded through a real dynamic import.
    //
    // This used to be:
    //   Function('return import("https://cdnjs.cloudflare.com/.../pdf.min.mjs")')()
    //
    // which broke the moment CSP went from Report-Only to enforcing. Two
    // separate violations, and fixing either alone still leaves the other:
    //   1. Function(string) is exactly what 'unsafe-eval' governs
    //   2. cdnjs.cloudflare.com is not in script-src, so even the import would
    //      have been blocked, as would the worker it then loaded
    //
    // The Function() wrapper existed to stop the bundler rewriting the URL. With
    // the package installed there is no URL to protect, so a plain dynamic
    // import works, code-splits away from the rest of the admin bundle, and
    // carries the request nonce like any other bundled script.
    //
    // NOT fixed by adding 'unsafe-eval' + cdnjs to the CSP: that would reopen
    // site-wide, for every page, the exact hole PR #230 closed — to serve one
    // admin upload form.
    const pdfjsLib = await import("pdfjs-dist");

    // pdf.js ships its own worker. Resolved through the bundler so it is served
    // from our own origin ('self'), not a CDN.
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const arrayBuffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({
      data: arrayBuffer,
      // pdf.js uses `new Function` internally for some font and colour-space
      // paths. Bundling it is not enough on its own — without this it trips the
      // SAME CSP rule from inside the library, which is a far more confusing
      // error to land on. Text extraction does not need those paths.
      isEvalSupported: false,
    }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // getTextContent returns TextItem | TextMarkedContent. Only TextItem
      // carries text; TextMarkedContent is structure (tagged-PDF markers) and
      // has no `str` at all. The CDN build was typed `any`, so this went
      // unnoticed — the old code read `.str` off marked-content items and
      // silently contributed "" for each. Filtering is what the empty string
      // was standing in for.
      const text = content.items
        .filter((item): item is TextItem => "str" in item)
        .map((item) => item.str)
        .join(" ");
      pages.push(text);
    }

    return pages.join("\n\n");
  }

  async function handleFileUpload(file: File) {
    setUpload({ kind: "uploading" });

    try {
      let text: string;
      if (file.name.toLowerCase().endsWith(".pdf")) {
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }

      if (!text.trim()) {
        setUpload({ kind: "error", message: "File contains no extractable text" });
        return;
      }

      const docTitle = title || file.name.replace(/\.[^.]+$/, "");

      const res = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle,
          category,
          text,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setUpload({ kind: "error", message: data.error ?? "Upload failed" });
        return;
      }

      setUpload({ kind: "processing", documentId: data.documentId });
      setTitle("");
      setTextContent("");
      setFileInputKey((k) => k + 1);
      fetchDocuments();
    } catch (err) {
      setUpload({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function handleTextSubmit() {
    if (!title.trim() || !textContent.trim()) return;
    setUpload({ kind: "uploading" });

    try {
      const res = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sourceType: "text",
          category,
          text: textContent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setUpload({ kind: "error", message: data.error ?? "Upload failed" });
        return;
      }

      setUpload({ kind: "processing", documentId: data.documentId });
      setTitle("");
      setTextContent("");
      fetchDocuments();
    } catch (err) {
      setUpload({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  async function handleDelete(documentId: string) {
    if (!confirm("Delete this document and all its chunks? This cannot be undone.")) {
      return;
    }

    await fetch(`/api/admin/knowledge?id=${documentId}`, { method: "DELETE" });
    fetchDocuments();
  }

  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const readyDocs = documents.filter((d) => d.status === "ready").length;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-ink">Knowledge Base</h2>
        <p className="mt-1 text-sm text-ink-subtle">
          Ingest reference documents (DMBOK, supplementary texts) for CDMP
          practice exam question generation.
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-800">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-hairline bg-surface-1 px-5 py-4">
          <p className="text-2xl font-semibold text-ink">{documents.length}</p>
          <p className="text-xs text-ink-subtle">Documents</p>
        </div>
        <div className="rounded-lg border border-hairline bg-surface-1 px-5 py-4">
          <p className="text-2xl font-semibold text-ink">{readyDocs}</p>
          <p className="text-xs text-ink-subtle">Ready</p>
        </div>
        <div className="rounded-lg border border-hairline bg-surface-1 px-5 py-4">
          <p className="text-2xl font-semibold text-ink">{totalChunks}</p>
          <p className="text-xs text-ink-subtle">Total Chunks</p>
        </div>
      </div>

      <div className="rounded-lg border border-hairline bg-surface-1 p-6">
        <h3 className="text-sm font-medium text-ink">Add Document</h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="DMBOK2 Chapter 3 — Data Governance"
              className="mt-1 w-full rounded-md border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
            >
              <option value="dmbok">DMBOK</option>
              <option value="supplementary">Supplementary</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
            Upload file (.pdf, .txt, .md)
          </label>
          <input
            key={fileInputKey}
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,.text"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
            className="mt-1 block w-full text-sm text-ink-subtle file:mr-4 file:rounded-md file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
          />
        </div>

        <div className="mt-4">
          <label className="text-[13px] font-medium uppercase tracking-[0.08em] text-ink-subtle">
            Or paste text content
          </label>
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            rows={8}
            placeholder="Paste book chapter text here..."
            className="mt-1 w-full rounded-md border border-hairline bg-canvas px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-subtle/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={handleTextSubmit}
            disabled={
              !title.trim() ||
              !textContent.trim() ||
              upload.kind === "uploading" ||
              upload.kind === "processing"
            }
            className="mt-3 inline-flex items-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-primary-hover disabled:opacity-50"
          >
            {upload.kind === "uploading"
              ? "Uploading..."
              : upload.kind === "processing"
                ? "Processing..."
                : "Ingest text"}
          </button>
        </div>

        {upload.kind === "success" && (
          <p className="mt-3 text-sm text-green-700">
            Document ingested successfully. Chunks are being embedded.
          </p>
        )}
        {upload.kind === "error" && (
          <p className="mt-3 text-sm text-red-700">{upload.message}</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-ink">Documents</h3>
        {loading ? (
          <p className="mt-4 text-sm text-ink-subtle">Loading...</p>
        ) : documents.length === 0 ? (
          <p className="mt-4 text-sm text-ink-subtle">
            No documents ingested yet. Upload your DMBOK to start generating
            practice exam questions.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-hairline bg-surface-1 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {doc.title}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-ink-subtle">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        doc.status === "ready"
                          ? "bg-green-100 text-green-800"
                          : doc.status === "processing"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                      }`}
                    >
                      {doc.status}
                    </span>
                    <span>{doc.chunkCount} chunks</span>
                    <span>{doc.category ?? "uncategorized"}</span>
                    <span>
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {doc.lastError && (
                    <p className="mt-1 truncate text-xs text-red-600">
                      {doc.lastError}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  className="ml-4 shrink-0 text-xs text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
