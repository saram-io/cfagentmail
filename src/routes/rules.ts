import { Hono } from "hono";
import { z } from "zod";
import {
  createAccessRuleRecord,
  listAccessRules,
  deleteAccessRuleRecord,
  getInbox,
} from "../db/queries";

const rulesRouter = new Hono<{ Bindings: Env }>();

const createRuleSchema = z.object({
  ruleType: z.enum(["allow", "block"]),
  pattern: z.string().min(1),
  action: z.enum(["reject", "spam"]).default("reject"),
  podId: z.string().optional(),
});

// POST /v1/inboxes/:inbox_id/rules - Create rule for inbox
rulesRouter.post("/:inbox_id/rules", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = createRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.message } }, 400);
  }

  const ruleId = `rule_${crypto.randomUUID()}`;
  const rule = await createAccessRuleRecord(c.env.DB, {
    id: ruleId,
    inboxId: inbox.id,
    podId: parsed.data.podId || inbox.podId,
    ruleType: parsed.data.ruleType,
    pattern: parsed.data.pattern,
    action: parsed.data.action,
  });

  return c.json(
    {
      rule_id: rule.id,
      id: rule.id,
      inbox_id: rule.inboxId,
      pod_id: rule.podId,
      rule_type: rule.ruleType,
      pattern: rule.pattern,
      action: rule.action,
      created_at: new Date(rule.createdAt).toISOString(),
    },
    201
  );
});

// GET /v1/inboxes/:inbox_id/rules - List rules for inbox
rulesRouter.get("/:inbox_id/rules", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const rules = await listAccessRules(c.env.DB, inbox.id, inbox.podId);

  return c.json({
    rules: rules.map((r) => ({
      rule_id: r.id,
      id: r.id,
      inbox_id: r.inboxId,
      pod_id: r.podId,
      rule_type: r.ruleType,
      pattern: r.pattern,
      action: r.action,
      created_at: new Date(r.createdAt).toISOString(),
    })),
    count: rules.length,
  });
});

// DELETE /v1/inboxes/:inbox_id/rules/:rule_id - Delete rule
rulesRouter.delete("/:inbox_id/rules/:rule_id", async (c) => {
  const inboxId = c.req.param("inbox_id");
  const ruleId = c.req.param("rule_id");

  const inbox = await getInbox(c.env.DB, inboxId);
  if (!inbox) {
    return c.json({ error: { code: "NOT_FOUND", message: "Inbox not found" } }, 404);
  }

  const deleted = await deleteAccessRuleRecord(c.env.DB, ruleId, inbox.id);
  if (!deleted) {
    return c.json({ error: { code: "NOT_FOUND", message: "Rule not found" } }, 404);
  }

  return c.json({ success: true, message: "Rule deleted" });
});

export { rulesRouter };
