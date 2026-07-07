import { describe, expect, it } from "vitest";
import { extractDocument, isAllowedExtension } from "./extract";

describe("extractDocument", () => {
  it("extracts text from a .txt file", async () => {
    const buf = Buffer.from(
      "This is a client brief about data governance and lineage.",
      "utf8",
    );
    const r = await extractDocument(buf, "brief.txt");
    expect(r.status).toBe("ready");
    expect(r.extractedText).toContain("data governance");
    expect(r.charCount).toBeGreaterThan(0);
    expect(r.errorReason).toBeNull();
  });

  it("extracts text from a .md file", async () => {
    const r = await extractDocument(
      Buffer.from("# Title\n\nBody text about the migration."),
      "notes.md",
    );
    expect(r.status).toBe("ready");
    expect(r.extractedText).toContain("Body text about the migration");
  });

  it("rejects an unsupported extension without persisting", async () => {
    const r = await extractDocument(Buffer.from("x"), "malware.exe");
    expect(r.status).toBe("unsupported");
    expect(r.errorReason).toBe("unsupported_type");
    expect(r.extractedText).toBe("");
  });

  it("rejects an empty / whitespace-only file", async () => {
    const r = await extractDocument(Buffer.from("   \n\t  "), "empty.txt");
    expect(r.status).toBe("unsupported");
    expect(r.extractedText).toBe("");
  });
});

describe("isAllowedExtension", () => {
  it("accepts pdf/txt/md/docx (any case), rejects others", () => {
    expect(isAllowedExtension("a.pdf")).toBe(true);
    expect(isAllowedExtension("A.DOCX")).toBe(true);
    expect(isAllowedExtension("notes.md")).toBe(true);
    expect(isAllowedExtension("image.png")).toBe(false);
    expect(isAllowedExtension("noextension")).toBe(false);
  });
});
