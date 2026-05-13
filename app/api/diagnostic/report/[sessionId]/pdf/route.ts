import { eq } from "drizzle-orm";
import puppeteer from "puppeteer";
import { cookies } from "next/headers";
import { getDb } from "../../../../../../lib/db";
import { assessmentSession } from "../../../../../../lib/db/schema";
import { getLeadFromCookies } from "../../../../../../lib/auth-server";
import { LEAD_SESSION_COOKIE } from "../../../../../../lib/auth-lead";

export const runtime = "nodejs";

// GET /api/diagnostic/report/[sessionId]/pdf
//
// Server-side PDF generation for the AI Readiness report. Owner-only —
// the requesting visitor must be signed in as the lead who owns the
// session. Public share-token recipients still get a PDF via the
// browser print dialog (the print stylesheet in globals.css covers
// them); only owners can hit this server-rendered route.
//
// Implementation: launches headless Chromium via Puppeteer, sets the
// lead session cookie programmatically, navigates to the report page,
// captures as PDF. The on-screen layout already includes the cover
// page redaction + section page breaks from C-1 polish; Puppeteer
// just removes the browser-default chrome (date / URL / page count)
// that Ctrl+P leaves in place.

const PDF_TIMEOUT_MS = 45_000;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  // UUID guard before any DB / Puppeteer work.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId,
    )
  ) {
    return new Response("Not found", { status: 404 });
  }

  // Owner check: cookie's lead must own this session.
  const session = await getLeadFromCookies();
  if (!session) {
    return new Response("Sign in to download a PDF.", { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({ leadId: assessmentSession.leadId })
    .from(assessmentSession)
    .where(eq(assessmentSession.id, sessionId))
    .limit(1);

  if (rows.length === 0 || rows[0].leadId !== session.leadId) {
    // 404 for any owner-mismatch — same pattern as the report page.
    return new Response("Not found", { status: 404 });
  }

  // Pull the raw cookie value so Puppeteer can set it on the page it
  // navigates. We have to hand it back to the headless browser because
  // the route page itself enforces owner-only access.
  const cookieStore = await cookies();
  const leadCookieValue = cookieStore.get(LEAD_SESSION_COOKIE)?.value;
  if (!leadCookieValue) {
    return new Response("Not found", { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const reportUrl = `${requestUrl.origin}/tools/ai-readiness/report/${sessionId}`;
  const isHttps = requestUrl.protocol === "https:";

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      // --no-sandbox needed on Render's container runtime where the
      // process doesn't have the setuid sandbox helper.
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Switch to print media BEFORE navigation so the page loads with
    // the @media print rules already active. Doing this post-goto
    // leaves React hydrated with screen styles that the pdf() pass
    // doesn't always re-resolve.
    await page.emulateMediaType("print");

    // Set the lead session cookie so the report page authorises this
    // self-call. Cookie domain has to match what Puppeteer navigates to.
    await page.setCookie({
      name: LEAD_SESSION_COOKIE,
      value: leadCookieValue,
      domain: requestUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
    });

    await page.goto(reportUrl, {
      waitUntil: "networkidle0",
      timeout: PDF_TIMEOUT_MS,
    });

    // Force light theme via a class on <html>. Chromium's print media
    // emulation has been unreliable in recent Puppeteer versions, so
    // we don't rely on @media print firing for the pdf() call. The
    // .pdf-mode class overrides the Tailwind theme tokens (set in
    // globals.css) so bg-canvas, text-fg, etc. all resolve to light.
    await page.evaluate(() => {
      document.documentElement.classList.add("pdf-mode");
    });

    // Pull the print-rendered PDF. Margins match the @page rule in
    // globals.css so the on-screen-when-printing layout is preserved.
    // displayHeaderFooter adds page numbers in the bottom margin.
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0.75in",
        right: "0.75in",
        bottom: "0.75in",
        left: "0.75in",
      },
      displayHeaderFooter: true,
      // Empty header — we don't want browser default date/URL.
      headerTemplate: "<div></div>",
      // Centered "page / total" footer. Skipped on the first page
      // (cover) so the cover stays clean; this is what Chromium does
      // when the footer template starts with the .pageNumber selector
      // and the page is page 1 of N — actually Chromium always
      // renders header/footer, so we keep page numbers on every page
      // including the cover. Acceptable trade-off vs the alternative
      // of no page numbers at all.
      footerTemplate: `
        <div style="
          font-size: 9px;
          color: #6b6b6b;
          width: 100%;
          padding: 0 0.75in;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span>Archos Labs · Confidential</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `,
      preferCSSPageSize: false,
    });

    // Friendly filename: prefix + short session id. Recipient can rename.
    const filename = `ai-readiness-report-${sessionId.slice(0, 8)}.pdf`;
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("PDF generation failed:", err);
    return new Response("Could not generate PDF. Try the browser print dialog instead.", {
      status: 500,
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
