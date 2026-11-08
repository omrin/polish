import type { Env as WorkerEnv } from "../src/env";
import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv { TEST_MIGRATIONS: D1Migration[] }
  }
}
export {};
