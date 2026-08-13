import "server-only";
import { Resend } from "resend";

/**
 * Transactional email.
 *
 * Thin wrapper so the pipeline never imports a provider SDK directly, and so an
 * unconfigured environment degrades to a logged no-op instead of throwing —
 * a missing API key should not fail a job that has already produced a recap.
 */

export class EmailError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "EmailError";
    this.permanent = permanent;
  }
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

let client: Resend | null = null;
function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  client ??= new Resend(key);
  return client;
}

function fromAddress() {
  return process.env.EMAIL_FROM ?? "meetsnaply <onboarding@resend.dev>";
}

export interface SendResult {
  /** False when email isn't configured — the caller shouldn't treat it as sent. */
  delivered: boolean;
  providerMessageId: string | null;
}

export interface EmailAttachment {
  filename: string;
  /** UTF-8 text; binary attachments would need a base64 path. */
  content: string;
  contentType?: string;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    console.warn(
      `[email] RESEND_API_KEY unset — would have sent "${options.subject}" to ${options.to}`,
    );
    return { delivered: false, providerMessageId: null };
  }

  const { data, error } = await resend().emails.send({
    from: fromAddress(),
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    ...(options.attachments?.length
      ? {
          attachments: options.attachments.map((attachment) => ({
            filename: attachment.filename,
            // Buffer, not a raw string: an .ics is CRLF-delimited and some
            // transports normalise line endings in string payloads, which
            // breaks strict parsers.
            content: Buffer.from(attachment.content, "utf8"),
            ...(attachment.contentType
              ? { contentType: attachment.contentType }
              : {}),
          })),
        }
      : {}),
  });

  if (error) {
    // A rejected address will be rejected again; rate limits and 5xx won't.
    const permanent = /invalid|not_found|validation/i.test(
      error.name ?? error.message ?? "",
    );
    throw new EmailError(error.message ?? String(error), permanent);
  }

  return { delivered: true, providerMessageId: data?.id ?? null };
}
