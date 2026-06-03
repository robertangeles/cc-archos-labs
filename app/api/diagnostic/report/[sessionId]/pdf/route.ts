import { eq } from "drizzle-orm";
import puppeteer from "puppeteer";
import { getDb } from "../../../../../../lib/db";
import { assessmentSession, lead } from "../../../../../../lib/db/schema";
import { getCurrentUser } from "../../../../../../lib/auth/current-user";
import { issueSession } from "../../../../../../lib/auth/session";
import { SESSION_COOKIE } from "../../../../../../lib/auth/session-jwt";
import { getPublicOrigin } from "../../../../../../lib/public-origin";

export const runtime = "nodejs";

const PDF_TIMEOUT_MS = 45_000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await ctx.params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId,
    )
  ) {
    return new Response("Not found", { status: 404 });
  }

  const auth = await getCurrentUser();
  if (!auth) {
    return new Response("Sign in to download a PDF.", { status: 401 });
  }

  const db = getDb();
  const rows = await db
    .select({
      userId: assessmentSession.userId,
      firstName: lead.firstName,
      lastName: lead.lastName,
      organisation: lead.organisation,
      generatedAt: assessmentSession.completedAt,
    })
    .from(assessmentSession)
    .leftJoin(lead, eq(lead.id, assessmentSession.leadId))
    .where(eq(assessmentSession.id, sessionId))
    .limit(1);

  if (rows.length === 0 || rows[0].userId !== auth.user.id) {
    return new Response("Not found", { status: 404 });
  }
  const recipientRow = rows[0];

  // Mint a fresh session for Puppeteer to use. The report page now
  // checks archos_session (getCurrentUser), so the headless browser
  // needs a valid JWT. Minting fresh avoids the 5-min JWT expiring
  // mid-navigation.
  const puppeteerSession = await issueSession({
    userId: auth.user.id,
    ipAddress: null,
    userAgent: "Puppeteer-PDF-Generator",
  });

  const publicOrigin = getPublicOrigin(request);
  const reportUrl = `${publicOrigin}/tools/ai-readiness/report/${sessionId}`;
  const cookieUrl = new URL(publicOrigin);
  const isHttps = cookieUrl.protocol === "https:";

  const preparedOn = (
    recipientRow.generatedAt ?? new Date()
  ).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const recipientLine = [
    recipientRow.firstName && recipientRow.lastName
      ? `Prepared for ${recipientRow.firstName} ${recipientRow.lastName}`
      : null,
    recipientRow.organisation,
  ]
    .filter(Boolean)
    .join(" · ");
  const headerHtml = `
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
      <span>${escapeHtml(recipientLine || "AI Readiness Assessment")}</span>
      <span>${escapeHtml(preparedOn)}</span>
    </div>
  `;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.emulateMediaType("print");

    await page.setCookie({
      name: SESSION_COOKIE,
      value: puppeteerSession.cookieValue,
      domain: cookieUrl.hostname,
      path: "/",
      httpOnly: true,
      secure: isHttps,
      sameSite: "Lax",
    });

    await page.goto(reportUrl, {
      waitUntil: "networkidle0",
      timeout: PDF_TIMEOUT_MS,
    });

    await page.evaluate(() => {
      document.documentElement.classList.add("pdf-mode");
    });

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
      headerTemplate: headerHtml,
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
    return new Response(
      "Could not generate PDF. Try the browser print dialog instead.",
      { status: 500 },
    );
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
