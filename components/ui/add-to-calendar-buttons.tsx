// Add-to-calendar buttons on the booking-success page (D17).
// Generates universal calendar links for Google, Apple/iCal (via .ics
// data URL), and Outlook. Server component — no interactivity; the
// browser handles each link's behaviour.
//
// All three render as ghost-styled anchors matching plan §17.4
// (accent reserved for the primary "Confirm booking" CTA).

const ghostLinkClass =
  "inline-flex items-center justify-center rounded-md border border-rule px-5 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export interface AddToCalendarButtonsProps {
  title: string;
  description: string;
  // UTC strings (ISO) — convert to provider format inline.
  startUtc: string;
  endUtc: string;
  // Where the meeting happens — usually the Google Meet URL.
  location: string;
  className?: string;
}

// YYYYMMDDTHHmmssZ — the compact ICS / Google Calendar format.
function toCompactUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function googleUrl(p: AddToCalendarButtonsProps): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates: `${toCompactUtc(p.startUtc)}/${toCompactUtc(p.endUtc)}`,
    details: p.description,
    location: p.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Outlook.com web calendar deep link.
function outlookUrl(p: AddToCalendarButtonsProps): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: p.title,
    body: p.description,
    location: p.location,
    startdt: p.startUtc,
    enddt: p.endUtc,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// ICS file as data URL — works in Apple Calendar / Outlook desktop /
// most clients. Plain text wrapper around the event.
function icsDataUrl(p: AddToCalendarButtonsProps): string {
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Archos Labs//Book a Call//EN",
    "BEGIN:VEVENT",
    `UID:${toCompactUtc(p.startUtc)}-archos@archoslabs.xyz`,
    `DTSTAMP:${toCompactUtc(new Date().toISOString())}`,
    `DTSTART:${toCompactUtc(p.startUtc)}`,
    `DTEND:${toCompactUtc(p.endUtc)}`,
    `SUMMARY:${p.title}`,
    `DESCRIPTION:${p.description.replace(/\n/g, "\\n")}`,
    `LOCATION:${p.location}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

export function AddToCalendarButtons(props: AddToCalendarButtonsProps) {
  const { className = "" } = props;
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <a
        href={googleUrl(props)}
        target="_blank"
        rel="noopener noreferrer"
        className={ghostLinkClass}
      >
        Add to Google
      </a>
      <a href={icsDataUrl(props)} download="archos-call.ics" className={ghostLinkClass}>
        Add to Apple
      </a>
      <a
        href={outlookUrl(props)}
        target="_blank"
        rel="noopener noreferrer"
        className={ghostLinkClass}
      >
        Add to Outlook
      </a>
    </div>
  );
}
