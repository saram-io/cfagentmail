import type { AiInsight } from "../types";

export interface ClassificationResult {
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  urgency: number; // 1-5
  labels: string[];
  actionItem?: string;
}

export async function analyzeEmailContent(
  ai: any,
  subject: string,
  bodyText: string
): Promise<ClassificationResult> {
  const cleanSubject = subject || "(no subject)";
  const cleanBody = bodyText || "";

  // If Cloudflare Workers AI binding is available, use LLM
  if (ai && typeof ai.run === "function") {
    try {
      const prompt = `You are an enterprise email triage AI. Analyze the following email:
Subject: ${cleanSubject}
Body:
${cleanBody.slice(0, 2000)}

Respond in valid JSON with these exact fields:
- summary: A 1-sentence summary of the email purpose
- sentiment: "positive", "neutral", or "negative"
- urgency: integer from 1 (lowest) to 5 (critical/urgent)
- labels: array of 1-4 uppercase category strings like ["SUPPORT", "BILLING", "URGENT", "SALES", "FEEDBACK", "SECURITY", "LEGAL"]
- actionItem: optional string suggesting next action for the agent`;

      const response: any = await ai.run("@cf/meta/llama-3.2-1b-instruct", {
        messages: [
          { role: "system", content: "You output only clean, valid JSON without Markdown backticks." },
          { role: "user", content: prompt },
        ],
      });

      const rawText = response?.response || JSON.stringify(response);
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || cleanSubject,
          sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
          urgency: typeof parsed.urgency === "number" ? Math.min(Math.max(parsed.urgency, 1), 5) : 3,
          labels: Array.isArray(parsed.labels) ? parsed.labels.map((l: string) => l.toUpperCase()) : ["INBOX"],
          actionItem: parsed.actionItem,
        };
      }
    } catch (err) {
      console.warn("[AI Classifier] Workers AI execution failed, using heuristic fallback:", err);
    }
  }

  // Heuristic / Rule-based classifier fallback (fast, deterministic, zero external dependency)
  return heuristicClassification(cleanSubject, cleanBody);
}

function heuristicClassification(subject: string, body: string): ClassificationResult {
  const content = `${subject} ${body}`.toLowerCase();

  const labels: Set<string> = new Set(["INBOX"]);
  let urgency = 2;
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  let actionItem: string | undefined;

  // Urgency & Security
  if (content.match(/urgent|asap|immediately|critical|outage|emergency|down|incident|security alert/)) {
    urgency = 5;
    labels.add("URGENT");
  } else if (content.match(/important|soon|priority|deadline/)) {
    urgency = 4;
    labels.add("PRIORITY");
  }

  // Support / Issues
  if (content.match(/error|failed|bug|broken|help|issue|ticket|problem|cannot|crash/)) {
    labels.add("SUPPORT");
    actionItem = "Investigate error logs and reply with troubleshooting steps.";
  }

  // Billing / Invoice
  if (content.match(/invoice|receipt|billing|payment|charge|subscription|pricing|refund/)) {
    labels.add("BILLING");
    actionItem = "Verify transaction in billing system.";
  }

  // Sales / Partnership
  if (content.match(/demo|pricing|proposal|contract|quote|partnership|enterprise|sales/)) {
    labels.add("SALES");
    actionItem = "Review proposal details with sales representative.";
  }

  // Sentiment
  if (content.match(/thank|great|awesome|excellent|love|perfect|appreciate|happy/)) {
    sentiment = "positive";
  } else if (content.match(/angry|frustrated|terrible|horrible|unacceptable|cancel|fail|bad/)) {
    sentiment = "negative";
  }

  // Summary
  const summary = subject !== "(no subject)" ? `Email regarding: ${subject}` : `Message received: "${body.slice(0, 60)}..."`;

  return {
    summary,
    sentiment,
    urgency,
    labels: Array.from(labels),
    actionItem,
  };
}
