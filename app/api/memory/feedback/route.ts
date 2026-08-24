import { and, eq } from "drizzle-orm";
import {
  inboxItems,
  managedBots,
  memoryFeedback,
} from "../../../../db/schema";
import { writeMemory } from "../../../../lib/supabase-memory";
import { managerAgentId } from "../../../../lib/agent-hierarchy";
import { authenticateTelegramRequest } from "../../../../lib/telegram-mini-app";
import {
  isTriageCategory,
  redactMessage,
} from "../../../../lib/triage";
import {
  DEFAULT_COMMUNITY_ID,
  ensureDefaultWorkspace,
  writeAuditEvent,
} from "../../../../lib/workspace";

type FeedbackPayload = {
  itemId?: string;
  correctedCategory?: string;
  rationale?: string;
  approved?: boolean;
};

export async function POST(request: Request) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;

  let payload: FeedbackPayload;
  try {
    payload = (await request.json()) as FeedbackPayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const correctedCategory = payload.correctedCategory?.trim() ?? "";
  const rationale = redactMessage(payload.rationale?.trim() ?? "").slice(0, 500);
  if (
    payload.approved !== true ||
    !payload.itemId ||
    !isTriageCategory(correctedCategory) ||
    rationale.length < 3
  ) {
    return Response.json(
      {
        error:
          "itemId, valid correctedCategory, rationale, and explicit approved=true are required",
      },
      { status: 400 },
    );
  }

  const ownerTelegramUserId = String(auth.session.user.id);
  const db = await ensureDefaultWorkspace();
  const [item] = await db
    .select({
      id: inboxItems.id,
      category: inboxItems.category,
      source: inboxItems.source,
      subjectId: inboxItems.externalChatId,
      managedBotId: managedBots.id,
      agentRole: managedBots.agentRole,
      agentTemplate: managedBots.templateId,
    })
    .from(inboxItems)
    .innerJoin(managedBots, eq(inboxItems.managedBotId, managedBots.id))
    .where(
      and(
        eq(inboxItems.id, payload.itemId),
        eq(inboxItems.ownerTelegramUserId, ownerTelegramUserId),
        eq(managedBots.ownerTelegramUserId, ownerTelegramUserId),
      ),
    )
    .limit(1);

  if (
    !item?.subjectId ||
    (item.source.includes("business") && item.agentRole !== "subagent")
  ) {
    return Response.json({ error: "Owned inbox item not found" }, { status: 404 });
  }

  const scope = item.source.includes("business")
    ? "private_inbox"
    : "community";
  const feedbackId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(memoryFeedback).values({
    id: feedbackId,
    communityId: DEFAULT_COMMUNITY_ID,
    inboxItemId: item.id,
    managedBotId: item.managedBotId,
    ownerTelegramUserId,
    scope,
    subjectId: item.subjectId,
    originalCategory: item.category,
    correctedCategory,
    rationale,
    supabaseStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });

  const memorySynced = await writeMemory({
    ownerId: ownerTelegramUserId,
    agentId:
      item.agentRole === "manager"
        ? managerAgentId(ownerTelegramUserId)
        : item.managedBotId,
    scope,
    subjectId: item.subjectId,
    kind: "creator_correction",
    summary: `The creator corrected a prior FairTurn classification from ${item.category} to ${correctedCategory}. Future comparable cases should consider this precedent: ${rationale}`,
    metadata: {
      feedbackId,
      inboxItemId: item.id,
      originalCategory: item.category,
      correctedCategory,
      approvedByCreator: true,
      rawContentStored: false,
    },
  });

  await Promise.all([
    db
      .update(memoryFeedback)
      .set({
        supabaseStatus: memorySynced ? "synced" : "pending",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(memoryFeedback.id, feedbackId)),
    db
      .update(inboxItems)
      .set({
        category: correctedCategory,
        status:
          correctedCategory === "low_priority"
            ? "filtered"
            : correctedCategory === "safety_escalation"
              ? "needs_human_route"
              : "needs_human_review",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(inboxItems.id, item.id)),
  ]);

  await writeAuditEvent({
    actorType: "human",
    actorId: ownerTelegramUserId,
    action: "creator_corrected_agent_memory",
    subjectType: "memory_feedback",
    subjectId: feedbackId,
    detail: {
      inboxItemId: item.id,
      managedBotId: item.managedBotId,
      agentRole: item.agentRole,
      originalCategory: item.category,
      correctedCategory,
      supabaseStatus: memorySynced ? "synced" : "pending",
      rawContentStored: false,
    },
  });

  return Response.json({
    ok: true,
    feedbackId,
    correction: { from: item.category, to: correctedCategory },
    supabaseMemoryStatus: memorySynced ? "synced" : "pending_configuration",
    nextComparableRunCanReferenceThisMemory: memorySynced,
  });
}
