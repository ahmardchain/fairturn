import { and, eq } from "drizzle-orm";
import { managedBots } from "../../../../db/schema";
import {
  formatCommunityReport,
  generateCommunityReport,
  type ReportPeriod,
} from "../../../../lib/community-reports";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../../lib/workspace";

export async function GET(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const managedBotId = url.searchParams.get("managedBotId")?.trim() ?? "";
  const chatId = url.searchParams.get("chatId")?.trim() ?? "";
  const periodValue = url.searchParams.get("period")?.trim() ?? "week";
  if (!managedBotId || !chatId || !["day", "week", "month"].includes(periodValue)) {
    return Response.json(
      { error: "managedBotId, chatId, and period=day|week|month are required" },
      { status: 400 },
    );
  }
  const period = periodValue as ReportPeriod;
  const ownerId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const [bot] = await db
    .select({ id: managedBots.id })
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, managedBotId),
        eq(managedBots.ownerTelegramUserId, ownerId),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  if (!bot) return Response.json({ error: "Owned active agent not found" }, { status: 404 });
  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId,
    telegramChatId: chatId,
  });
  const report = await generateCommunityReport({ communityId, period });
  await writeAuditEvent({
    communityId,
    actorType: "human",
    actorId: ownerId,
    action: "community_report_generated",
    subjectType: "community",
    subjectId: communityId,
    detail: { period, rawMessageContentIncluded: false },
  });
  return Response.json({
    ok: true,
    communityId,
    report,
    formattedText: formatCommunityReport(report),
  });
}

