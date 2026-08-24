import {
  cleanKnowledgeText,
  fetchCommunityKnowledgeUrl,
  maxKnowledgeFileBytes,
  storeCommunityKnowledge,
  supportedKnowledgeFileTypes,
  type CommunityKnowledgeKind,
  type StoreCommunityKnowledgeInput,
} from "./community-knowledge";
import { extractKnowledgeWithFairTurnMind } from "./minds";
import {
  bytesToBase64,
  deleteKnowledgeObject,
  storeKnowledgeObject,
} from "./object-storage";

const textKnowledgeTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "application/json",
]);

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/\0]/gu, "-")
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .trim()
    .slice(0, 140);
  return cleaned || "community-knowledge";
}

export function inferKnowledgeMimeType(fileName: string, supplied?: string) {
  if (supplied && supportedKnowledgeFileTypes.has(supplied.toLowerCase())) {
    return supplied.toLowerCase();
  }
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "html" || extension === "htm") return "text/html";
  if (extension === "json") return "application/json";
  if (extension === "txt") return "text/plain";
  return supplied?.toLowerCase() || "application/octet-stream";
}

export type KnowledgeIngestionBase = Pick<
  StoreCommunityKnowledgeInput,
  | "communityId"
  | "managedBotId"
  | "sparkId"
  | "kind"
  | "title"
  | "learningMode"
  | "sourceMessageId"
  | "createdByTelegramUserId"
>;

export async function ingestKnowledgeText(
  input: KnowledgeIngestionBase & {
    content: string;
    sourceType?: "content" | "telegram_message";
  },
) {
  return storeCommunityKnowledge({
    ...input,
    content: input.content,
    sourceType: input.sourceType ?? "content",
  });
}

export async function ingestKnowledgeUrl(
  input: KnowledgeIngestionBase & { url: string },
) {
  const fetched = await fetchCommunityKnowledgeUrl(input.url);
  return storeCommunityKnowledge({
    ...input,
    content: fetched.content,
    sourceType: "url",
    sourceUrl: fetched.url,
  });
}

export async function ingestKnowledgeFile(
  input: KnowledgeIngestionBase & {
    bytes: Uint8Array;
    fileName: string;
    mimeType?: string;
    sourceType: "telegram_file" | "mini_app_file";
  },
) {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > maxKnowledgeFileBytes) {
    throw new Error(
      `Knowledge files must be smaller than ${Math.floor(maxKnowledgeFileBytes / 1_000_000)} MB`,
    );
  }
  const fileName = safeFileName(input.fileName);
  const mimeType = inferKnowledgeMimeType(fileName, input.mimeType);
  if (!supportedKnowledgeFileTypes.has(mimeType)) {
    throw new Error(
      "FairTurn supports PDF, DOCX, TXT, Markdown, HTML, and JSON knowledge files",
    );
  }
  const objectKey = [
    "community-knowledge",
    input.createdByTelegramUserId.replace(/[^0-9A-Za-z_-]/gu, "_"),
    input.communityId.replace(/[^0-9A-Za-z_-]/gu, "_"),
    crypto.randomUUID(),
    encodeURIComponent(fileName),
  ].join("/");

  await storeKnowledgeObject({
    key: objectKey,
    bytes: input.bytes,
    contentType: mimeType,
  });

  try {
    let content = "";
    let title = input.title.trim() || fileName.replace(/\.[^.]+$/u, "");
    if (textKnowledgeTypes.has(mimeType)) {
      content = new TextDecoder().decode(input.bytes);
      if (mimeType === "text/html") content = cleanKnowledgeText(content);
    } else {
      const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "bin";
      const extracted = await extractKnowledgeWithFairTurnMind({
        conversationKey: `${input.communityId}:${input.managedBotId}:${objectKey}`,
        requestedTitle: title,
        fileName,
        mimeType,
        attachment: {
          content: bytesToBase64(input.bytes),
          fileName,
          mimeType,
          extension,
        },
      });
      title = extracted.title || title;
      content =
        extracted.content ||
        `Administrator-approved ${mimeType === "application/pdf" ? "PDF" : "DOCX"} source: ${fileName}. The full document is securely stored and will be attached to FairTurn when members ask relevant questions.`;
    }

    const result = await storeCommunityKnowledge({
      ...input,
      title,
      content,
      sourceType: input.sourceType,
      sourceFileName: fileName,
      sourceMimeType: mimeType,
      sourceObjectKey: objectKey,
      sourceBytes: input.bytes.byteLength,
    });
    return { ...result, title, fileName, mimeType };
  } catch (error) {
    await deleteKnowledgeObject(objectKey);
    throw error;
  }
}

export function knowledgeKindFromValue(
  value: string,
  fallback: CommunityKnowledgeKind = "docs",
) {
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  const aliases: Record<string, CommunityKnowledgeKind> = {
    rule: "rules",
    rules: "rules",
    faq: "faq",
    question: "faq",
    doc: "docs",
    docs: "docs",
    document: "docs",
    whitepaper: "docs",
    link: "links",
    links: "links",
    role: "roles",
    roles: "roles",
    policy: "moderation_policy",
    moderation: "moderation_policy",
    moderation_policy: "moderation_policy",
  };
  return aliases[normalized] ?? fallback;
}
