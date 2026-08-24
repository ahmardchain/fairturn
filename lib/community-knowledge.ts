import { and, desc, eq } from "drizzle-orm";
import { communityKnowledge } from "../db/schema";
import { getDb } from "../db";
import {
  bytesToBase64,
  deleteKnowledgeObject,
  readKnowledgeObject,
} from "./object-storage";

export const communityKnowledgeKinds = [
  "rules",
  "faq",
  "docs",
  "links",
  "roles",
  "moderation_policy",
] as const;

export type CommunityKnowledgeKind =
  (typeof communityKnowledgeKinds)[number];

export const maxKnowledgeCharacters = 120_000;
export const maxKnowledgeFileBytes = 8_000_000;

export const supportedKnowledgeFileTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isCommunityKnowledgeKind(
  value: string,
): value is CommunityKnowledgeKind {
  return communityKnowledgeKinds.includes(value as CommunityKnowledgeKind);
}

export function cleanKnowledgeText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

export function safeKnowledgeUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^127\./u.test(host) ||
      /^10\./u.test(host) ||
      /^192\.168\./u.test(host) ||
      /^169\.254\./u.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function fetchCommunityKnowledgeUrl(value: string) {
  const initialUrl = safeKnowledgeUrl(value);
  if (!initialUrl) throw new Error("Knowledge links must be public HTTPS URLs");
  let url: URL = initialUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount < 4; redirectCount += 1) {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "text/plain,text/markdown,text/html,application/json",
        },
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const locationHeader: string | null = response.headers.get("location");
      const redirected: URL | null = locationHeader
        ? safeKnowledgeUrl(new URL(locationHeader, url.toString()).toString())
        : null;
      if (!redirected) {
        throw new Error("Knowledge link redirected to an unsafe location");
      }
      url = redirected;
      response = undefined;
    }
    if (!response) throw new Error("Knowledge link redirected too many times");
    if (!response.ok) throw new Error("FairTurn could not read that knowledge link");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("text/") &&
      !contentType.includes("application/json")
    ) {
      throw new Error(
        "Knowledge links currently support readable text, Markdown, HTML, or JSON pages",
      );
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 500_000) {
      throw new Error("Knowledge link is too large");
    }
    const raw = (await response.text()).slice(0, maxKnowledgeCharacters + 1);
    return {
      url: response.url,
      content: contentType.includes("text/html")
        ? cleanKnowledgeText(raw)
        : raw.trim(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function knowledgeChecksum(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value.normalize("NFKC").trim()),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type StoreCommunityKnowledgeInput = {
  communityId: string;
  managedBotId: string;
  sparkId: string;
  kind: CommunityKnowledgeKind;
  title: string;
  content: string;
  sourceType:
    | "content"
    | "url"
    | "telegram_message"
    | "telegram_file"
    | "mini_app_file";
  sourceUrl?: string | null;
  sourceFileName?: string | null;
  sourceMimeType?: string | null;
  sourceObjectKey?: string | null;
  sourceBytes?: number | null;
  learningMode:
    | "mini_app"
    | "telegram_chat"
    | "telegram_auto";
  sourceMessageId?: string | null;
  createdByTelegramUserId: string;
};

export async function storeCommunityKnowledge(
  input: StoreCommunityKnowledgeInput,
) {
  const content = cleanKnowledgeText(input.content);
  if (content.length < 8 || content.length > maxKnowledgeCharacters) {
    throw new Error(
      `Knowledge content must be 8–${maxKnowledgeCharacters.toLocaleString()} characters`,
    );
  }
  const title = input.title.trim();
  if (title.length < 2 || title.length > 120) {
    throw new Error("Knowledge title must be 2–120 characters");
  }
  const checksum = await knowledgeChecksum(
    [
      input.kind,
      title,
      content,
      input.sourceFileName ?? "",
      input.sourceBytes ?? "",
    ].join(":"),
  );
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  const [created] = await db
    .insert(communityKnowledge)
    .values({
      id,
      communityId: input.communityId,
      managedBotId: input.managedBotId,
      sparkId: input.sparkId,
      kind: input.kind,
      title,
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl ?? null,
      sourceFileName: input.sourceFileName ?? null,
      sourceMimeType: input.sourceMimeType ?? null,
      sourceObjectKey: input.sourceObjectKey ?? null,
      sourceBytes: input.sourceBytes ?? null,
      learningMode: input.learningMode,
      sourceMessageId: input.sourceMessageId ?? null,
      content,
      checksum,
      status: "active",
      createdByTelegramUserId: input.createdByTelegramUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: communityKnowledge.id });

  if (!created && input.sourceObjectKey) {
    await deleteKnowledgeObject(input.sourceObjectKey);
  }
  return { id: created?.id ?? null, duplicate: !created };
}

const knowledgeSelection = {
  id: communityKnowledge.id,
  kind: communityKnowledge.kind,
  title: communityKnowledge.title,
  content: communityKnowledge.content,
  sourceType: communityKnowledge.sourceType,
  sourceUrl: communityKnowledge.sourceUrl,
  sourceFileName: communityKnowledge.sourceFileName,
  sourceMimeType: communityKnowledge.sourceMimeType,
  sourceObjectKey: communityKnowledge.sourceObjectKey,
  sourceBytes: communityKnowledge.sourceBytes,
  learningMode: communityKnowledge.learningMode,
  sourceMessageId: communityKnowledge.sourceMessageId,
  updatedAt: communityKnowledge.updatedAt,
};

export async function getCommunityKnowledge(input: {
  communityId: string;
  managedBotId: string;
  kind?: CommunityKnowledgeKind;
  limit?: number;
}) {
  const db = await getDb();
  const rows = await db
    .select(knowledgeSelection)
    .from(communityKnowledge)
    .where(
      and(
        eq(communityKnowledge.communityId, input.communityId),
        eq(communityKnowledge.managedBotId, input.managedBotId),
        eq(communityKnowledge.status, "active"),
        ...(input.kind ? [eq(communityKnowledge.kind, input.kind)] : []),
      ),
    )
    .orderBy(desc(communityKnowledge.updatedAt))
    .limit(Math.min(Math.max(input.limit ?? 12, 1), 100));

  return rows.map((row) => ({ ...row, content: row.content.slice(0, 4_000) }));
}

function searchTerms(query: string) {
  const stop = new Set([
    "about",
    "after",
    "could",
    "fairturn",
    "from",
    "have",
    "please",
    "tell",
    "that",
    "their",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
    "would",
  ]);
  return Array.from(
    new Set(
      query
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu)
        ?.filter((term) => !stop.has(term)) ?? [],
    ),
  ).slice(0, 20);
}

export async function getRelevantCommunityKnowledge(input: {
  communityId: string;
  managedBotId: string;
  query: string;
  limit?: number;
}) {
  const rows = await getCommunityKnowledge({
    communityId: input.communityId,
    managedBotId: input.managedBotId,
    limit: 60,
  });
  const terms = searchTerms(input.query);
  const scored = rows.map((row, index) => {
    const title = row.title.toLowerCase();
    const content = row.content.toLowerCase();
    const score = terms.reduce(
      (total, term) =>
        total +
        (title.includes(term) ? 8 : 0) +
        (content.includes(term) ? 2 : 0),
      row.kind === "rules" || row.kind === "faq" ? 1 : 0,
    );
    return { row, score, index };
  });
  scored.sort(
    (left, right) => right.score - left.score || left.index - right.index,
  );
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);
  return scored.slice(0, limit).map((entry) => entry.row);
}

export async function getKnowledgeAttachments(
  rows: Awaited<ReturnType<typeof getRelevantCommunityKnowledge>>,
) {
  const attachments: Array<{
    content: string;
    fileName: string;
    mimeType: string;
    extension: string;
  }> = [];
  for (const row of rows) {
    if (
      attachments.length >= 2 ||
      !row.sourceObjectKey ||
      !row.sourceFileName ||
      !row.sourceMimeType ||
      (row.sourceBytes ?? 0) > maxKnowledgeFileBytes
    ) {
      continue;
    }
    const bytes = await readKnowledgeObject(row.sourceObjectKey);
    if (!bytes || bytes.byteLength > maxKnowledgeFileBytes) continue;
    const extension =
      row.sourceFileName.split(".").at(-1)?.toLowerCase() ?? "bin";
    attachments.push({
      content: bytesToBase64(bytes),
      fileName: row.sourceFileName,
      mimeType: row.sourceMimeType,
      extension,
    });
  }
  return attachments;
}

export async function removeCommunityKnowledge(input: {
  communityId: string;
  managedBotId: string;
  knowledgeId: string;
}) {
  const db = await getDb();
  const [item] = await db
    .select({
      id: communityKnowledge.id,
      sourceObjectKey: communityKnowledge.sourceObjectKey,
    })
    .from(communityKnowledge)
    .where(
      and(
        eq(communityKnowledge.id, input.knowledgeId),
        eq(communityKnowledge.communityId, input.communityId),
        eq(communityKnowledge.managedBotId, input.managedBotId),
      ),
    )
    .limit(1);
  if (!item) return false;
  await db.delete(communityKnowledge).where(eq(communityKnowledge.id, item.id));
  await deleteKnowledgeObject(item.sourceObjectKey);
  return true;
}
