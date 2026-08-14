import PostalMime, { type Email as ParsedEmail } from "postal-mime";

export interface ParsedEmailData {
  messageIdHeader: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  from: {
    email: string;
    name?: string;
  };
  to: { email: string; name?: string }[];
  cc: { email: string; name?: string }[];
  bcc: { email: string; name?: string }[];
  replyTo: { email: string; name?: string }[];
  subject: string;
  text: string | null;
  html: string | null;
  snippet: string | null;
  attachments: {
    filename: string;
    mimeType: string;
    disposition: "attachment" | "inline";
    contentId?: string;
    size: number;
    content: ArrayBuffer;
  }[];
}

export async function parseRawEmail(
  rawBuffer: ArrayBuffer | Uint8Array
): Promise<ParsedEmailData> {
  const parser = new PostalMime();
  const parsed: ParsedEmail = await parser.parse(rawBuffer);

  const fromEmail = parsed.from?.address?.toLowerCase() || "";
  const fromName = parsed.from?.name || undefined;

  const mapAddressList = (list?: any[]) => {
    if (!list || !Array.isArray(list)) return [];
    return list.map((item) => ({
      email: (item.address || "").toLowerCase(),
      name: item.name || undefined,
    }));
  };

  const to = mapAddressList(parsed.to);
  const cc = mapAddressList(parsed.cc);
  const bcc = mapAddressList(parsed.bcc);
  const replyTo = mapAddressList(parsed.replyTo);

  // Extract snippet (first 160 characters of clean text)
  let snippet: string | null = null;
  if (parsed.text) {
    snippet = parsed.text.trim().replace(/\s+/g, " ").slice(0, 160);
  } else if (parsed.html) {
    const stripped = parsed.html.replace(/<[^>]*>?/gm, " ").trim().replace(/\s+/g, " ");
    snippet = stripped.slice(0, 160);
  }

  // Parse attachments
  const attachments = (parsed.attachments || []).map((att) => ({
    filename: att.filename || `attachment-${crypto.randomUUID().slice(0, 8)}`,
    mimeType: att.mimeType || "application/octet-stream",
    disposition: (att.disposition === "inline" ? "inline" : "attachment") as "attachment" | "inline",
    contentId: att.contentId || undefined,
    size: att.content instanceof ArrayBuffer ? att.content.byteLength : (att.content as any)?.length || 0,
    content: att.content instanceof ArrayBuffer ? att.content : new Uint8Array(att.content as any).buffer,
  }));

  // References and in-reply-to
  let inReplyTo: string | null = null;
  if (parsed.inReplyTo) {
    inReplyTo = parsed.inReplyTo;
  }

  let referencesHeader: string | null = null;
  if (parsed.references) {
    referencesHeader = Array.isArray(parsed.references)
      ? (parsed.references as string[]).join(" ")
      : String(parsed.references);
  }

  return {
    messageIdHeader: parsed.messageId || null,
    inReplyTo,
    referencesHeader,
    from: {
      email: fromEmail,
      name: fromName,
    },
    to,
    cc,
    bcc,
    replyTo,
    subject: parsed.subject || "(no subject)",
    text: parsed.text || null,
    html: parsed.html || null,
    snippet,
    attachments,
  };
}

/**
 * Strips quoted reply lines and email headers to get only the latest reply content.
 */
export function extractReplyContent(text: string): string {
  if (!text) return "";

  const lines = text.split("\n");
  const resultLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Standard quotation line starting with >
    if (/^\s*>/.test(line)) {
      break;
    }

    // Common reply headers: "On [Date], [Name] wrote:" or "---------- Original Message ----------"
    if (/^On\s.+wrote:\s*$/i.test(line.trim())) {
      break;
    }
    if (/^--+\s*Original Message\s*--+/i.test(line.trim())) {
      break;
    }
    if (/^From:\s.+/i.test(line.trim()) && i > 0 && lines[i - 1].trim() === "") {
      break;
    }

    resultLines.push(line);
  }

  return resultLines.join("\n").trim();
}
