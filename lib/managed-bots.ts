export const managedAgentTemplateIds = [
  "fairturn",
  "guardian",
  "scout",
  "host",
  "giveaway",
  "quiz",
] as const;

export type ManagedAgentTemplateId = (typeof managedAgentTemplateIds)[number];

export type TelegramBotUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_manage_bots?: boolean;
};

type TelegramPhotoSize = {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramUserProfilePhotos = {
  total_count: number;
  photos: TelegramPhotoSize[][];
};

type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

type TelegramApiResult<T> = {
  ok?: boolean;
  result?: T;
  description?: string;
};

const encoder = new TextEncoder();
const profilePhotoCache = new Map<
  string,
  { expiresAt: number; value: string | null }
>();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomSecret(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function telegramBotApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as TelegramApiResult<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(payload.description ?? `Telegram ${method} failed`);
  }
  return payload.result;
}

const conversationalBotMenus = new Set<string>();
const configuredManagerRuntimes = new Set<string>();

export const FAIRTURN_TELEGRAM_ALLOWED_UPDATES = [
  "managed_bot",
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "business_connection",
  "business_message",
  "edited_business_message",
  "deleted_business_messages",
  "callback_query",
  "chat_join_request",
  "my_chat_member",
  "poll",
  "poll_answer",
] as const;

export const FAIRTURN_OPEN_APP_LABEL = "Open App";
export const FAIRTURN_PUBLIC_APP_ORIGIN =
  "https://fairturn.ahmardchain.chatgpt.site";
export const FAIRTURN_PUBLIC_WEBHOOK_ORIGIN =
  "https://fairturn.ahmardchain.workers.dev";

function isLocalTelegramRuntimeOrigin(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function fairTurnMiniAppOrigin(requestOrigin: string) {
  const origin = new URL(requestOrigin);
  if (isLocalTelegramRuntimeOrigin(origin)) return origin.origin;
  if (
    origin.hostname.endsWith(".workers.dev") ||
    origin.hostname.endsWith(".chatgpt.site")
  ) {
    return FAIRTURN_PUBLIC_APP_ORIGIN;
  }
  return origin.origin;
}

export function fairTurnTelegramWebhookOrigin(requestOrigin: string) {
  const origin = new URL(requestOrigin);
  if (isLocalTelegramRuntimeOrigin(origin)) return origin.origin;
  if (
    origin.hostname.endsWith(".workers.dev") ||
    origin.hostname.endsWith(".chatgpt.site")
  ) {
    return FAIRTURN_PUBLIC_WEBHOOK_ORIGIN;
  }
  return origin.origin;
}

export function fairTurnMiniAppMenuButton(appUrl: string) {
  const url = new URL(appUrl);
  if (url.protocol !== "https:") {
    throw new Error("Telegram Mini App URLs must use HTTPS");
  }
  return {
    type: "web_app",
    text: FAIRTURN_OPEN_APP_LABEL,
    web_app: { url: url.toString() },
  } as const;
}

export async function ensureConversationalBotInterface(input: {
  token: string;
  botTelegramUserId: string;
  appUrl: string;
}) {
  if (conversationalBotMenus.has(input.botTelegramUserId)) return;
  await Promise.all([
    telegramBotApi<boolean>(input.token, "deleteMyCommands", {}),
    telegramBotApi<boolean>(input.token, "setChatMenuButton", {
      menu_button: fairTurnMiniAppMenuButton(input.appUrl),
    }),
  ]);
  conversationalBotMenus.add(input.botTelegramUserId);
}

export function isManagedAgentTemplateId(
  value: string,
): value is ManagedAgentTemplateId {
  return managedAgentTemplateIds.includes(value as ManagedAgentTemplateId);
}

export function managedAgentCanModerate(templateId: string) {
  return templateId === "fairturn" || templateId === "guardian";
}

export function managedAgentCanManageInbox(
  templateId: string,
  agentRole: "manager" | "subagent",
) {
  return (
    agentRole === "subagent" &&
    (templateId === "fairturn" || templateId === "scout")
  );
}

export function managedAgentCanRunGiveaways(templateId: string) {
  return templateId === "fairturn" || templateId === "giveaway";
}

export function normalizeBotUsername(value: string) {
  return value.trim().replace(/^@/u, "");
}

export function validateManagedBotInput(name: string, usernameInput: string) {
  const username = normalizeBotUsername(usernameInput);
  if (name.length < 1 || name.length > 64) {
    return { ok: false as const, error: "Bot name must be 1–64 characters" };
  }
  if (!/^[A-Za-z0-9_]{5,32}$/u.test(username) || !/bot$/iu.test(username)) {
    return {
      ok: false as const,
      error:
        "Username must be 5–32 letters, numbers, or underscores and end in bot",
    };
  }
  return { ok: true as const, username };
}

export function createFairTurnAgentSuggestion() {
  const random = new Uint8Array(4);
  crypto.getRandomValues(random);
  const suffix = Array.from(random, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return {
    name: "FairTurn",
    username: `FairTurn${suffix}Bot`,
  };
}

export async function getManagerBot(token: string) {
  return telegramBotApi<TelegramBotUser>(token, "getMe");
}

export async function getTelegramProfilePhotoDataUrl(
  token: string,
  telegramUserId: string | number,
) {
  const cacheKey = String(telegramUserId);
  const cached = profilePhotoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const profilePhotos = await telegramBotApi<TelegramUserProfilePhotos>(
      token,
      "getUserProfilePhotos",
      { user_id: telegramUserId, offset: 0, limit: 1 },
    );
    const smallestPhoto = profilePhotos.photos[0]?.[0];
    if (!smallestPhoto) {
      profilePhotoCache.set(cacheKey, {
        expiresAt: Date.now() + 60_000,
        value: null,
      });
      return null;
    }

    const file = await telegramBotApi<TelegramFile>(token, "getFile", {
      file_id: smallestPhoto.file_id,
    });
    if (!file.file_path) return null;

    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`,
    );
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (!contentType?.startsWith("image/")) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1_000_000) return null;

    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8_192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
    }
    const value = `data:${contentType};base64,${btoa(binary)}`;
    profilePhotoCache.set(cacheKey, {
      expiresAt: Date.now() + 10 * 60_000,
      value,
    });
    return value;
  } catch {
    return null;
  }
}

export function createManagedBotDeepLink(
  managerUsername: string,
  newUsername: string,
  newName: string,
) {
  const manager = normalizeBotUsername(managerUsername);
  const username = normalizeBotUsername(newUsername);
  return `https://t.me/newbot/${encodeURIComponent(manager)}/${encodeURIComponent(username)}?name=${encodeURIComponent(newName)}`;
}

export async function encryptManagedBotToken(token: string, encryptionSecret: string) {
  if (encryptionSecret.length < 24) {
    throw new Error("MANAGED_BOT_ENCRYPTION_KEY must contain at least 24 characters");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(token),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

export async function decryptManagedBotToken(
  ciphertext: string,
  ivValue: string,
  encryptionSecret: string,
) {
  if (encryptionSecret.length < 24) {
    throw new Error("MANAGED_BOT_ENCRYPTION_KEY must contain at least 24 characters");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(ivValue) },
    key,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function hashWebhookSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function provisionManagedBot(input: {
  managerToken: string;
  botId: number;
  botName: string;
  appOrigin: string;
  webhookOrigin?: string;
  encryptionSecret: string;
}) {
  const token = await telegramBotApi<string>(input.managerToken, "getManagedBotToken", {
    user_id: input.botId,
  });
  const encryptedToken = await encryptManagedBotToken(token, input.encryptionSecret);
  const webhookSecret = randomSecret();
  const webhookSecretHash = await hashWebhookSecret(webhookSecret);

  await telegramBotApi<boolean>(token, "setWebhook", {
    url: `${input.webhookOrigin ?? input.appOrigin}/api/telegram/webhook`,
    secret_token: webhookSecret,
    allowed_updates: FAIRTURN_TELEGRAM_ALLOWED_UPDATES,
    drop_pending_updates: false,
  });

  await Promise.allSettled([
    telegramBotApi<boolean>(token, "setMyDescription", {
      description:
        "Chat naturally with FairTurn for moderation, community knowledge, creator opportunities, events, giveaways, quizzes, and approved automations.",
    }),
    telegramBotApi<boolean>(token, "setMyShortDescription", {
      short_description: "A conversational FairTurn creator and community agent.",
    }),
    telegramBotApi<boolean>(token, "deleteMyCommands", {}),
    telegramBotApi<boolean>(token, "setChatMenuButton", {
      menu_button: fairTurnMiniAppMenuButton(input.appOrigin),
    }),
  ]);

  return {
    tokenCiphertext: encryptedToken.ciphertext,
    tokenIv: encryptedToken.iv,
    webhookSecretHash,
  };
}

export async function ensureManagerBotRuntime(input: {
  token: string;
  botTelegramUserId: string;
  appOrigin: string;
  webhookOrigin?: string;
  webhookSecret: string;
}) {
  const webhookOrigin = input.webhookOrigin ?? input.appOrigin;
  const key = `${input.botTelegramUserId}:${input.appOrigin}:${webhookOrigin}`;
  if (configuredManagerRuntimes.has(key)) return;
  await telegramBotApi<boolean>(input.token, "setWebhook", {
    url: `${webhookOrigin}/api/telegram/webhook`,
    secret_token: input.webhookSecret,
    allowed_updates: FAIRTURN_TELEGRAM_ALLOWED_UPDATES,
    drop_pending_updates: false,
  });
  await ensureConversationalBotInterface({
    token: input.token,
    botTelegramUserId: input.botTelegramUserId,
    appUrl: input.appOrigin,
  });
  configuredManagerRuntimes.add(key);
}
