type StoredObjectBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
};

type FairTurnBucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<StoredObjectBody | null>;
  delete(key: string): Promise<void>;
};

async function getBucket() {
  const runtime = await getRuntimeEnv();
  return runtime.BUCKET as FairTurnBucket | undefined;
}

export async function storeKnowledgeObject(input: {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}) {
  const bucket = await getBucket();
  if (!bucket) throw new Error("FairTurn document storage is unavailable");
  await bucket.put(input.key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
  });
}

export async function readKnowledgeObject(key: string) {
  const bucket = await getBucket();
  if (!bucket) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}

export async function deleteKnowledgeObject(key?: string | null) {
  if (!key) return;
  const bucket = await getBucket();
  if (!bucket) return;
  await bucket.delete(key);
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.length),
    );
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
import { getRuntimeEnv } from "./runtime-env";
