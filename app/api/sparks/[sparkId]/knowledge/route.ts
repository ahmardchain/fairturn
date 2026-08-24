import { and, desc, eq } from "drizzle-orm";
import { communityKnowledge, managedBots } from "../../../../../db/schema";
import {
  isCommunityKnowledgeKind,
  maxKnowledgeFileBytes,
  removeCommunityKnowledge,
} from "../../../../../lib/community-knowledge";
import {
  ingestKnowledgeFile,
  ingestKnowledgeText,
  ingestKnowledgeUrl,
} from "../../../../../lib/knowledge-ingestion";
import { authenticateTelegramRequest } from "../../../../../lib/telegram-mini-app";
import {
  ensureDefaultWorkspace,
  ensureTelegramCommunity,
  writeAuditEvent,
} from "../../../../../lib/workspace";

type KnowledgePayload = {
  chatId?: string | number;
  kind?: string;
  title?: string;
  content?: string;
  url?: string;
  knowledgeId?: string;
};

type ParsedKnowledgePayload = KnowledgePayload & {
  file?: { bytes: Uint8Array; fileName: string; mimeType?: string };
};

async function parsePayload(request: Request): Promise<ParsedKnowledgePayload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > maxKnowledgeFileBytes) {
        throw new Error("Knowledge files must be smaller than 8 MB");
      }
      return {
        chatId: String(form.get("chatId") ?? ""),
        kind: String(form.get("kind") ?? ""),
        title: String(form.get("title") ?? file.name),
        content: String(form.get("content") ?? ""),
        url: String(form.get("url") ?? ""),
        file: {
          bytes: new Uint8Array(await file.arrayBuffer()),
          fileName: file.name,
          mimeType: file.type || undefined,
        },
      };
    }
    return {
      chatId: String(form.get("chatId") ?? ""),
      kind: String(form.get("kind") ?? ""),
      title: String(form.get("title") ?? ""),
      content: String(form.get("content") ?? ""),
      url: String(form.get("url") ?? ""),
    };
  }
  return (await request.json()) as KnowledgePayload;
}

async function ownedAgent(input: { ownerId: string; sparkId: string }) {
  const db = await ensureDefaultWorkspace();
  const [bot] = await db
    .select({ id: managedBots.id, templateId: managedBots.templateId })
    .from(managedBots)
    .where(
      and(
        eq(managedBots.id, input.sparkId),
        eq(managedBots.ownerTelegramUserId, input.ownerId),
        eq(managedBots.status, "active"),
      ),
    )
    .limit(1);
  return bot;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sparkId: string }> },
) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const { sparkId } = await context.params;
  const ownerId = String(auth.session.user.id);
  const chatId = new URL(request.url).searchParams.get("chatId")?.trim();
  if (!chatId || !(await ownedAgent({ ownerId, sparkId }))) {
    return Response.json(
      { error: "Owned agent and chatId are required" },
      { status: 404 },
    );
  }
  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId: sparkId,
    telegramChatId: chatId,
  });
  const db = await ensureDefaultWorkspace();
  const items = await db
    .select({
      id: communityKnowledge.id,
      kind: communityKnowledge.kind,
      title: communityKnowledge.title,
      sourceType: communityKnowledge.sourceType,
      sourceUrl: communityKnowledge.sourceUrl,
      sourceFileName: communityKnowledge.sourceFileName,
      sourceMimeType: communityKnowledge.sourceMimeType,
      sourceBytes: communityKnowledge.sourceBytes,
      learningMode: communityKnowledge.learningMode,
      status: communityKnowledge.status,
      updatedAt: communityKnowledge.updatedAt,
    })
    .from(communityKnowledge)
    .where(
      and(
        eq(communityKnowledge.communityId, communityId),
        eq(communityKnowledge.managedBotId, sparkId),
      ),
    )
    .orderBy(desc(communityKnowledge.updatedAt))
    .limit(100);
  return Response.json({ sparkId, communityId, items });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sparkId: string }> },
) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const { sparkId } = await context.params;
  const ownerId = String(auth.session.user.id);
  if (!(await ownedAgent({ ownerId, sparkId }))) {
    return Response.json({ error: "Owned active agent not found" }, { status: 404 });
  }

  let payload: ParsedKnowledgePayload;
  try {
    payload = await parsePayload(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid knowledge payload" },
      { status: 400 },
    );
  }

  const chatId = payload.chatId ? String(payload.chatId).trim() : "";
  const kindValue = payload.kind?.trim().toLowerCase() ?? "";
  const title = payload.title?.trim() ?? "";
  if (
    !chatId ||
    !isCommunityKnowledgeKind(kindValue) ||
    title.length < 2 ||
    title.length > 120
  ) {
    return Response.json(
      {
        error:
          "chatId, a valid knowledge kind, and a 2–120 character title are required",
      },
      { status: 400 },
    );
  }

  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId: sparkId,
    telegramChatId: chatId,
  });
  const base = {
    communityId,
    managedBotId: sparkId,
    sparkId,
    kind: kindValue,
    title,
    learningMode: "mini_app" as const,
    sourceMessageId: null,
    createdByTelegramUserId: ownerId,
  };

  try {
    const result = payload.file
      ? await ingestKnowledgeFile({
          ...base,
          ...payload.file,
          sourceType: "mini_app_file",
        })
      : payload.url?.trim()
        ? await ingestKnowledgeUrl({ ...base, url: payload.url.trim() })
        : await ingestKnowledgeText({
            ...base,
            content: payload.content?.trim() ?? "",
          });

    await writeAuditEvent({
      communityId,
      actorType: "human",
      actorId: ownerId,
      action: result.duplicate
        ? "community_knowledge_duplicate"
        : "community_knowledge_ingested",
      subjectType: "community_knowledge",
      subjectId: result.id ?? undefined,
      detail: {
        sparkId,
        kind: kindValue,
        sourceType: payload.file ? "mini_app_file" : payload.url ? "url" : "content",
        rawPrivateMessage: false,
      },
    });

    return Response.json(
      {
        ok: true,
        sparkId,
        communityId,
        knowledgeId: result.id,
        duplicate: result.duplicate,
        persistedForAgentLifetime: true,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Knowledge ingestion failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sparkId: string }> },
) {
  const auth = await authenticateTelegramRequest(request);
  if (!auth.ok) return auth.response;
  const { sparkId } = await context.params;
  const ownerId = String(auth.session.user.id);
  if (!(await ownedAgent({ ownerId, sparkId }))) {
    return Response.json({ error: "Owned active agent not found" }, { status: 404 });
  }
  let payload: KnowledgePayload;
  try {
    payload = (await request.json()) as KnowledgePayload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const chatId = payload.chatId ? String(payload.chatId).trim() : "";
  const knowledgeId = payload.knowledgeId?.trim() ?? "";
  if (!chatId || !knowledgeId) {
    return Response.json({ error: "chatId and knowledgeId are required" }, { status: 400 });
  }
  const communityId = await ensureTelegramCommunity({
    ownerTelegramUserId: ownerId,
    managedBotId: sparkId,
    telegramChatId: chatId,
  });
  const removed = await removeCommunityKnowledge({
    communityId,
    managedBotId: sparkId,
    knowledgeId,
  });
  if (!removed) return Response.json({ error: "Knowledge item not found" }, { status: 404 });
  await writeAuditEvent({
    communityId,
    actorType: "human",
    actorId: ownerId,
    action: "community_knowledge_deleted",
    subjectType: "community_knowledge",
    subjectId: knowledgeId,
    detail: { sparkId, rawDocumentDeleted: true },
  });
  return Response.json({ ok: true, removed: knowledgeId });
}
