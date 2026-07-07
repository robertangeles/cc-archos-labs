// pdf-parse ships no types. We import the /lib subpath (not the package main)
// to avoid its debug harness that reads a bundled test PDF at require time when
// run as the entry module — the same gotcha scripts/ingest-pdf.mjs works around.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
