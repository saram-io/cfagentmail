import type { SendMessageRequest, MessageRecipient } from "../types";

export interface OutboundSendResult {
  messageId: string;
}

export async function sendEmailViaBinding(
  emailBinding: SendEmail,
  sender: { email: string; name?: string },
  request: SendMessageRequest,
  extraHeaders?: Record<string, string>
): Promise<OutboundSendResult> {
  const normalizeRecipients = (recipients?: string | string[] | MessageRecipient[]): string[] => {
    if (!recipients) return [];
    if (typeof recipients === "string") return [recipients];
    return recipients.map((r) => (typeof r === "string" ? r : r.email));
  };

  const toList = normalizeRecipients(request.to);
  if (toList.length === 0) {
    throw new Error("At least one recipient is required in 'to'");
  }

  const ccList = normalizeRecipients(request.cc);
  const bccList = normalizeRecipients(request.bcc);

  let replyToAddress: string | undefined;
  if (request.replyTo) {
    replyToAddress =
      typeof request.replyTo === "string"
        ? request.replyTo
        : request.replyTo.email;
  }

  // Format attachments for Workers binding
  const attachments = (request.attachments || []).map((att) => {
    // If base64 encoded content string, decode to Uint8Array/ArrayBuffer if possible, or pass string
    let content: any = att.content;
    try {
      // Check if it's base64 encoded
      if (typeof att.content === "string" && !att.content.includes("\n") && att.content.length % 4 === 0) {
        const binaryString = atob(att.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        content = bytes.buffer;
      }
    } catch {
      content = att.content;
    }

    return {
      filename: att.filename,
      type: att.type || "application/octet-stream",
      content,
      disposition: att.disposition || "attachment",
      contentId: att.contentId,
    };
  });

  const mergedHeaders: Record<string, string> = {
    ...(extraHeaders || {}),
    ...(request.headers || {}),
  };

  const sendPayload: any = {
    to: toList,
    from: {
      email: sender.email,
      name: sender.name || undefined,
    },
    subject: request.subject,
    text: request.text || (request.html ? request.html.replace(/<[^>]*>?/gm, " ") : ""),
    html: request.html || undefined,
  };

  if (ccList.length > 0) sendPayload.cc = ccList;
  if (bccList.length > 0) sendPayload.bcc = bccList;
  if (replyToAddress) sendPayload.replyTo = replyToAddress;
  if (Object.keys(mergedHeaders).length > 0) sendPayload.headers = mergedHeaders;
  if (attachments.length > 0) sendPayload.attachments = attachments;

  const result = await emailBinding.send(sendPayload);
  return {
    messageId: (result as any)?.messageId || `msg_${crypto.randomUUID()}`,
  };
}
