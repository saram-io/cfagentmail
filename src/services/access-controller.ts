import { listAccessRulesForInbox } from "../db/queries";
import type { AccessRule } from "../types";

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: "allow" | "reject" | "spam";
  matchedRule?: AccessRule;
  reason?: string;
}

export function matchesPattern(pattern: string, email: string): boolean {
  const cleanEmail = email.toLowerCase().trim();
  const cleanPattern = pattern.toLowerCase().trim();

  // Exact email match: alice@example.com
  if (cleanPattern === cleanEmail) {
    return true;
  }

  // Domain match: @example.com or example.com
  const domain = cleanEmail.split("@")[1];
  if (cleanPattern.startsWith("@") && domain === cleanPattern.substring(1)) {
    return true;
  }
  if (!cleanPattern.includes("@") && domain === cleanPattern) {
    return true;
  }

  // Wildcard match: *@example.com or *spam*
  if (cleanPattern.includes("*")) {
    const regexPattern = "^" + cleanPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    const regex = new RegExp(regexPattern, "i");
    return regex.test(cleanEmail);
  }

  return false;
}

export async function evaluateAccessPolicy(
  db: D1Database,
  inboxId: string,
  podId: string | null | undefined,
  senderEmail: string
): Promise<PolicyEvaluationResult> {
  const rules = await listAccessRulesForInbox(db, inboxId, podId);
  if (!rules || rules.length === 0) {
    return { allowed: true, action: "allow" };
  }

  const allowRules = rules.filter((r) => r.ruleType === "allow");
  const blockRules = rules.filter((r) => r.ruleType === "block");

  // 1. Check Allowlist (if allowlist rules are configured, sender MUST match at least one)
  if (allowRules.length > 0) {
    const matchedAllow = allowRules.find((r) => matchesPattern(r.pattern, senderEmail));
    if (!matchedAllow) {
      return {
        allowed: false,
        action: "reject",
        reason: `Sender ${senderEmail} is not on the inbox allowlist`,
      };
    }
  }

  // 2. Check Blocklist (if sender matches any block rule, apply rule action)
  for (const blockRule of blockRules) {
    if (matchesPattern(blockRule.pattern, senderEmail)) {
      return {
        allowed: blockRule.action !== "reject",
        action: blockRule.action,
        matchedRule: blockRule,
        reason: `Sender ${senderEmail} matched blocklist rule (${blockRule.pattern})`,
      };
    }
  }

  return { allowed: true, action: "allow" };
}
