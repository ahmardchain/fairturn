import { telegramBotApi } from "./managed-bots";

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function getTelegramPhotoAttachment(input: {
  token: string;
  photos?: TelegramPhotoSize[];
}) {
  const candidates = (input.photos ?? [])
    .filter((photo) => photo.file_id)
    .filter((photo) => !photo.file_size || photo.file_size <= 4_000_000);
  const photo = candidates.at(-1);
  if (!photo) return null;

  const file = await telegramBotApi<{ file_path?: string; file_size?: number }>(
    input.token,
    "getFile",
    { file_id: photo.file_id },
  );
  if (!file.file_path || (file.file_size ?? 0) > 4_000_000) return null;

  const response = await fetch(
    `https://api.telegram.org/file/bot${input.token}/${file.file_path}`,
  );
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4_000_000) return null;
  return {
    content: bytesToBase64(bytes),
    fileName: `telegram-photo-${photo.file_unique_id ?? "moderation"}.jpg`,
    mimeType: "image/jpeg",
    extension: "jpg",
  };
}

export async function getTelegramDocumentBytes(input: {
  token: string;
  document: TelegramDocument;
  maxBytes?: number;
}) {
  const maxBytes = Math.min(Math.max(input.maxBytes ?? 8_000_000, 1), 20_000_000);
  if (
    !input.document.file_id ||
    (input.document.file_size ?? 0) > maxBytes
  ) {
    throw new Error("That document is too large for FairTurn knowledge");
  }
  const file = await telegramBotApi<{ file_path?: string; file_size?: number }>(
    input.token,
    "getFile",
    { file_id: input.document.file_id },
  );
  if (!file.file_path || (file.file_size ?? 0) > maxBytes) {
    throw new Error("Telegram could not prepare that knowledge document");
  }
  const response = await fetch(
    `https://api.telegram.org/file/bot${input.token}/${file.file_path}`,
  );
  if (!response.ok) throw new Error("FairTurn could not download that document");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error("That document is too large for FairTurn knowledge");
  }
  return bytes;
}
