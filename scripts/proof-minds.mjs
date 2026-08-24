import { mkdir, writeFile } from "node:fs/promises";
import { createMindsClient } from "@animocabrands/minds-client-lib";

const builderApiKey = process.env.MINDS_BUILDER_API_KEY;
const mindId = process.env.MINDS_MIND_ID;
if (!builderApiKey || !mindId) {
  throw new Error("Set MINDS_BUILDER_API_KEY and MINDS_MIND_ID first");
}

const alias =
  process.env.FAIRTURN_MINDS_PROOF_ALIAS ??
  "fairturn-hackathon-persistence-proof";
const marker = "CEDAR-ANCHOR-71";
const client = createMindsClient({ builderApiKey });
const [mind, cognition] = await Promise.all([
  client.getMind(mindId),
  client.getCognitionBalance(mindId),
]);
if (mind.mindId !== mindId) {
  throw new Error("The configured Mind ID did not match the Builder API response");
}
if (mind.isEnabled === false) {
  throw new Error("The configured FairTurn Mind is disabled");
}
if (!Number.isFinite(cognition.cognition) || cognition.cognition <= 0) {
  throw new Error("The configured FairTurn Mind has no cognition remaining");
}
await client.ensureConversation(alias, mindId);

async function sendAndWait(messageText) {
  const before = await client.getLatestHistoryFingerprint(alias);
  await client.sendMessage({ alias, messageText });
  const outcome = await client.waitForReply({
    alias,
    timeoutMs: 180_000,
    afterFingerprint: before,
    sentMessageText: messageText,
  });
  if (outcome.timedOut) throw new Error("The FairTurn Mind timed out");
  return outcome.reply;
}

const sessionA = await sendAndWait(
  `FAIRTURN PERSISTENCE PROOF — SESSION A. In this creator community, the phrase "ship it hot" is established friendly encouragement, not harassment. Store this precedent with marker ${marker}. Reply briefly that the precedent was understood.`,
);
const sessionBPrompt =
  "FAIRTURN PERSISTENCE PROOF — SESSION B. A returning member writes: ship it hot. Without being given the old precedent again, classify the tone and include the exact stored marker that supports your decision.";
const sessionB = await sendAndWait(sessionBPrompt);
const sessionBText = sessionB.messageText ?? "";
const pass = sessionBText.includes(marker);

const artifact = {
  generatedAt: new Date().toISOString(),
  mindId,
  mindIdentity: {
    name: mind.name ?? null,
    email: mind.email ?? null,
    model: mind.model ?? null,
    species: mind.species ?? null,
    enabled: mind.isEnabled !== false,
  },
  cognitionRemaining: cognition.cognition,
  alias,
  pass,
  assertions: {
    stableConversationAlias: true,
    separateMessages: true,
    originalPrecedentRepeatedInSessionB: false,
    storedMarkerRecovered: pass,
  },
  fingerprints: {
    sessionAReply: sessionA.fingerprint,
    sessionBReply: sessionB.fingerprint,
  },
  sessionBReply: sessionBText,
};

await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../artifacts/minds_persistence_proof.json", import.meta.url),
  `${JSON.stringify(artifact, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(artifact, null, 2));
if (!pass) process.exitCode = 1;
