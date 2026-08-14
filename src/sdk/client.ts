import { InboxesClient } from "./inboxes";
import { MessagesClient } from "./messages";
import { ThreadsClient } from "./threads";
import { DraftsClient } from "./drafts";
import { PodsClient } from "./pods";
import { RulesClient } from "./rules";
import { WebhooksClient } from "./webhooks";
import type { ClientOptions } from "./types";

export class CFAgentMail {
  readonly inboxes: InboxesClient;
  readonly messages: MessagesClient;
  readonly threads: ThreadsClient;
  readonly drafts: DraftsClient;
  readonly pods: PodsClient;
  readonly rules: RulesClient;
  readonly webhooks: WebhooksClient;

  constructor(options: ClientOptions = {}) {
    this.inboxes = new InboxesClient(options);
    this.messages = new MessagesClient(options);
    this.threads = new ThreadsClient(options);
    this.drafts = new DraftsClient(options);
    this.pods = new PodsClient(options);
    this.rules = new RulesClient(options);
    this.webhooks = new WebhooksClient(options);
  }
}
