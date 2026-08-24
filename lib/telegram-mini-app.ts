import { getRuntimeEnv } from "./runtime-env";

export type TelegramMiniAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramSession = {
  user: TelegramMiniAppUser;
  authDate: number;
};

const encoder = new TextEncoder();

async function signHmac(key: ArrayBuffer | Uint8Array | string, value: string) {
  const rawKey = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)),
  );
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyTelegramMiniAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 24 * 60 * 60,
): Promise<TelegramSession | null> {
  if (!initData || initData.length > 16_384) return null;

  const params = new URLSearchParams(initData);
  const suppliedHash = params.get("hash")?.toLowerCase();
  const userJson = params.get("user");
  const authDate = Number(params.get("auth_date"));
  if (!suppliedHash || !userJson || !Number.isFinite(authDate)) return null;

  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await signHmac("WebAppData", botToken);
  const expectedHash = bytesToHex(await signHmac(secretKey, dataCheckString));
  if (!constantTimeEqual(expectedHash, suppliedHash)) return null;

  const now = Math.floor(Date.now() / 1_000);
  if (authDate > now + 60 || now - authDate > maxAgeSeconds) return null;

  try {
    const user = JSON.parse(userJson) as TelegramMiniAppUser;
    if (!Number.isSafeInteger(user.id) || !user.first_name) return null;
    return { user, authDate };
  } catch {
    return null;
  }
}

export async function authenticateTelegramRequest(request: Request) {
  const runtime = await getRuntimeEnv();
  if (!runtime.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "FairTurn's Telegram management bot is not configured" },
        { status: 503 },
      ),
    };
  }

  const initData = request.headers.get("x-telegram-init-data") ?? "";
  const session = await verifyTelegramMiniAppInitData(
    initData,
    runtime.TELEGRAM_BOT_TOKEN,
  );
  if (!session) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Open FairTurn from Telegram to create or view managed bots" },
        { status: 401 },
      ),
    };
  }

  return { ok: true as const, runtime, session };
}
