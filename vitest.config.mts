import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: {
            DB: "cfagentmail-db-id",
          },
          r2Buckets: {
            ATTACHMENTS: "cfagentmail-attachments",
          },
        },
      },
    },
  },
});
