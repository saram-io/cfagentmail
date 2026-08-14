// R2 Storage Service for Raw EML files and Attachments

export async function saveRawEmail(
  r2: R2Bucket,
  inboxId: string,
  messageId: string,
  rawContent: ArrayBuffer | Uint8Array | string
): Promise<string> {
  const key = `raw/${inboxId}/${messageId}.eml`;
  await r2.put(key, rawContent, {
    httpMetadata: {
      contentType: "message/rfc822",
    },
    customMetadata: {
      inboxId,
      messageId,
      storedAt: Date.now().toString(),
    },
  });
  return key;
}

export async function getRawEmail(
  r2: R2Bucket,
  r2Key: string
): Promise<R2ObjectBody | null> {
  return await r2.get(r2Key);
}

export async function saveAttachment(
  r2: R2Bucket,
  inboxId: string,
  messageId: string,
  attachmentId: string,
  filename: string,
  contentType: string,
  content: ArrayBuffer | Uint8Array | string
): Promise<string> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `attachments/${inboxId}/${messageId}/${attachmentId}_${safeFilename}`;

  let finalBody: any = content;
  if (typeof content === "string") {
    try {
      // Check if it's base64 encoded
      if (!content.includes("\n") && content.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
        const binaryString = atob(content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        finalBody = bytes.buffer;
      }
    } catch {
      finalBody = content;
    }
  }

  await r2.put(key, finalBody, {
    httpMetadata: {
      contentType: contentType || "application/octet-stream",
      contentDisposition: `attachment; filename="${safeFilename}"`,
    },
    customMetadata: {
      inboxId,
      messageId,
      attachmentId,
      filename,
    },
  });

  return key;
}

export async function getAttachmentObject(
  r2: R2Bucket,
  r2Key: string
): Promise<R2ObjectBody | null> {
  return await r2.get(r2Key);
}
