import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  let env: { DB?: D1Database };
  try {
    const workerRuntime = await import("cloudflare:workers");
    env = workerRuntime.env as unknown as { DB?: D1Database };
  } catch {
    env = {};
  }
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
