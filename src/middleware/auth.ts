import { createMiddleware } from "hono/factory";
import { verifyApiKey } from "../db/queries";

export interface AuthContext {
  apiKeyId?: string;
  inboxId?: string | null;
  isMaster?: boolean;
}

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: {
    auth?: AuthContext;
  };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim();
  }

  // Master key check (if configured in env)
  const masterKey = (c.env as any).MASTER_API_KEY;
  if (masterKey && token && token === masterKey) {
    c.set("auth", { isMaster: true, inboxId: null });
    return await next();
  }

  if (token) {
    const verified = await verifyApiKey(c.env.DB, token);
    if (verified) {
      // Check inbox scope if route path targets an inbox: /v1/inboxes/:inbox_id
      const match = c.req.path.match(/^\/v1\/inboxes\/([^/?#]+)/);
      const targetInboxId = match ? decodeURIComponent(match[1]) : undefined;

      if (
        verified.inboxId &&
        targetInboxId &&
        targetInboxId !== verified.inboxId &&
        targetInboxId !== ""
      ) {
        return c.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "API key is not authorized for this inbox",
            },
          },
          403
        );
      }

      c.set("auth", {
        apiKeyId: verified.id,
        inboxId: verified.inboxId,
        isMaster: !verified.inboxId,
      });
      return await next();
    } else {
      return c.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid API key provided",
          },
        },
        401
      );
    }
  }

  // If no MASTER_API_KEY is configured and no token passed, allow open access for dev/testing
  if (masterKey) {
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Valid API key is required. Provide 'Authorization: Bearer <key>' or 'X-API-Key'.",
        },
      },
      401
    );
  }

  c.set("auth", { isMaster: true, inboxId: null });
  return await next();
});
