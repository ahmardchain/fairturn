import { and, eq, lte } from "drizzle-orm";
import { followups } from "../../../db/schema";
import { getRuntimeEnv } from "../../../lib/runtime-env";
import { ensureDefaultWorkspace, writeAuditEvent } from "../../../lib/workspace";

export async function POST(request: Request) {
  const runtime = await getRuntimeEnv();
  const authorization = request.headers.get("authorization");
  if (!runtime.CRON_SECRET || authorization !== `Bearer ${runtime.CRON_SECRET}`) {
    return Response.json({ error: "Invalid scheduler authorization" }, { status: 401 });
  }

  const db = await ensureDefaultWorkspace();
  const now = new Date().toISOString();
  const due = await db
    .select()
    .from(followups)
    .where(and(eq(followups.status, "pending"), lte(followups.scheduledFor, now)))
    .limit(50);

  for (const followup of due) {
    await db
      .update(followups)
      .set({ status: "ready_for_human" })
      .where(eq(followups.id, followup.id));
    await writeAuditEvent({
      actorType: "system",
      actorId: "followup_scheduler",
      action: "followup_became_due",
      subjectType: "followup",
      subjectId: followup.id,
      detail: {
        inboxItemId: followup.inboxItemId,
        automaticMessageSent: false,
      },
    });
  }

  return Response.json({
    ok: true,
    processed: due.length,
    action: "queued_for_human_review",
  });
}
