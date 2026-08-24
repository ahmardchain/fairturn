export type FairTurnRuntimeEnv = {
  BUCKET?: unknown;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  MANAGED_BOT_ENCRYPTION_KEY?: string;
  MINDS_BUILDER_API_KEY?: string;
  MINDS_MIND_ID?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  ADMIN_ACTION_SECRET?: string;
  CRON_SECRET?: string;
};

export async function getRuntimeEnv(): Promise<FairTurnRuntimeEnv> {
  try {
    const workerRuntime = await import("cloudflare:workers");
    return workerRuntime.env as unknown as FairTurnRuntimeEnv;
  } catch {
    return process.env as FairTurnRuntimeEnv;
  }
}
