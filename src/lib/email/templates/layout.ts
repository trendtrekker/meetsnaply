import "server-only";

/**
 * Shared chrome for every transactional email.
 *
 * Inline styles and table layout, not the app's Tailwind: mail clients strip
 * <style> blocks and Outlook's renderer has no flexbox or grid. Keeping the shell
 * in one place is what stops the recap and booking emails from drifting into two
 * different-looking products.
 */

export const BRAND = "#e8552f";
export const INK = "#171610";
export const MUTED = "#6e6a5c";
export const PAPER = "#f6f2e6";
export const SURFACE = "#fffdf7";
export const BORDER = "#ded7c0";
export const HAIRLINE = "#ede8d6";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Wraps body rows in the outer card. `rows` must be `<tr>` markup. */
export function shell(options: {
  preheader: string;
  rows: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <!-- Preheader: the grey preview line in the inbox. Hidden in the body itself,
       otherwise the client repeats the first sentence twice. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(options.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:${SURFACE};border-radius:16px;border:1px solid ${BORDER}">
    ${options.rows}
  </table>
</body>
</html>`;
}

export function header(options: {
  title: string;
  subtitle?: string | null;
  eyebrow?: string;
}): string {
  return `
    <tr><td style="padding:32px 32px 0">
      <p style="margin:0;font-size:13px;font-weight:700;color:${BRAND}">${escapeHtml(options.eyebrow ?? "meetsnaply")}</p>
      <h1 style="margin:12px 0 4px;font-size:22px;line-height:1.25;color:${INK}">${escapeHtml(options.title)}</h1>
      ${
        options.subtitle
          ? `<p style="margin:0;font-size:14px;color:${MUTED}">${escapeHtml(options.subtitle)}</p>`
          : ""
      }
    </td></tr>`;
}

export function paragraph(text: string, options: { muted?: boolean } = {}): string {
  return `
    <tr><td style="padding:20px 32px 0">
      <p style="margin:0;font-size:${options.muted ? "14px" : "16px"};line-height:1.6;color:${options.muted ? MUTED : INK}">${escapeHtml(text)}</p>
    </td></tr>`;
}

/** Label/value rows — the "when / where / who" block. */
export function detailList(items: { label: string; value: string }[]): string {
  return `
    <tr><td style="padding:20px 32px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
        ${items
          .map(
            (item) => `
        <tr>
          <td style="padding:8px 0;vertical-align:top;width:88px">
            <span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${escapeHtml(item.label)}</span>
          </td>
          <td style="padding:8px 0;font-size:15px;line-height:1.5;color:${INK}">${escapeHtml(item.value)}</td>
        </tr>`,
          )
          .join("")}
      </table>
    </td></tr>`;
}

export function bulletSection(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `
    <tr><td style="padding:0 32px 4px">
      <p style="margin:20px 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">${escapeHtml(title)}</p>
      <ul style="margin:0;padding-left:20px;color:${INK};font-size:15px;line-height:1.6">
        ${items.map((item) => `<li style="margin-bottom:6px">${escapeHtml(item)}</li>`).join("")}
      </ul>
    </td></tr>`;
}

export function button(url: string, label: string): string {
  return `
    <tr><td style="padding:28px 32px 0">
      <a href="${escapeHtml(url)}"
         style="display:inline-block;background:${BRAND};color:#fff8f4;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px">
        ${escapeHtml(label)}
      </a>
    </td></tr>`;
}

/** Secondary actions rendered as plain links, e.g. reschedule / cancel. */
export function linkRow(links: { url: string; label: string }[]): string {
  if (links.length === 0) return "";
  return `
    <tr><td style="padding:16px 32px 0">
      <p style="margin:0;font-size:14px;color:${MUTED}">
        ${links
          .map(
            (link) =>
              `<a href="${escapeHtml(link.url)}" style="color:${BRAND};text-decoration:underline">${escapeHtml(link.label)}</a>`,
          )
          .join(" &nbsp;·&nbsp; ")}
      </p>
    </td></tr>`;
}

export function footnote(text: string): string {
  return `
    <tr><td style="padding:24px 32px 32px">
      <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${HAIRLINE};font-size:12px;line-height:1.6;color:${MUTED}">
        ${escapeHtml(text)}
      </p>
    </td></tr>`;
}
