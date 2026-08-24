import {
  detectModerationSignals,
  normalizeAutoModerationPolicy,
  planContextualSafetyOverride,
  planModerationActions,
  type ContextualSafetyAssessment,
} from "../../../../lib/moderation-engine";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

export async function POST(request: Request) {
  const runtime = await getRuntimeEnv();
  if (
    !runtime.ADMIN_ACTION_SECRET ||
    request.headers.get("x-fairturn-admin-secret") !==
      runtime.ADMIN_ACTION_SECRET
  ) {
    return Response.json({ error: "Invalid operator authorization" }, { status: 401 });
  }
  let payload: {
    message?: string;
    priorMatchingMessages?: number;
    priorOffenses?: number;
    communityNorms?: unknown;
    safetyAssessment?: ContextualSafetyAssessment;
    adminIdentity?: {
      checked?: boolean;
      senderIsAdministrator?: boolean;
      hasStrongIdentitySimilarity?: boolean;
      identityConfidence?: number;
      evidence?: string[];
    };
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const message = payload.message?.trim() ?? "";
  if (!message || message.length > 6_000) {
    return Response.json({ error: "A 1–6,000 character message is required" }, { status: 400 });
  }
  const verdict = detectModerationSignals({
    text: message,
    priorMatchingMessages: Math.min(
      Math.max(Math.floor(payload.priorMatchingMessages ?? 0), 0),
      100,
    ),
  });
  const priorOffenses = Math.min(
    Math.max(Math.floor(payload.priorOffenses ?? 0), 0),
    100,
  );
  const validSafetyAssessment = Boolean(
    payload.safetyAssessment &&
      typeof payload.safetyAssessment.intent === "string" &&
      [
        "benign",
        "scam_social_engineering",
        "heated_argument",
        "continued_conflict",
        "other_violation",
        "uncertain",
      ].includes(payload.safetyAssessment.intent) &&
      typeof payload.safetyAssessment.confidence === "number" &&
      Number.isFinite(payload.safetyAssessment.confidence) &&
      payload.safetyAssessment.confidence >= 0 &&
      payload.safetyAssessment.confidence <= 1 &&
      Array.isArray(payload.safetyAssessment.evidence) &&
      payload.safetyAssessment.evidence.every(
        (entry) => typeof entry === "string",
      ),
  );
  const contextualOverride = validSafetyAssessment
    ? planContextualSafetyOverride({
        deterministicVerdict: verdict,
        safetyAssessment: payload.safetyAssessment!,
        adminIdentity: payload.adminIdentity
          ? {
              checked: payload.adminIdentity.checked === true,
              senderIsAdministrator:
                payload.adminIdentity.senderIsAdministrator === true,
              hasStrongIdentitySimilarity:
                payload.adminIdentity.hasStrongIdentitySimilarity === true,
              identityConfidence: Number(
                payload.adminIdentity.identityConfidence ?? 0,
              ),
              evidence: Array.isArray(payload.adminIdentity.evidence)
                ? payload.adminIdentity.evidence.filter(
                    (entry): entry is string => typeof entry === "string",
                  )
                : [],
            }
          : null,
        priorOffenses,
      })
    : null;
  const effectiveVerdict = contextualOverride?.verdict ?? verdict;
  const plan =
    contextualOverride?.plan ??
    planModerationActions({
      verdict: effectiveVerdict,
      priorOffenses,
      policy: normalizeAutoModerationPolicy(payload.communityNorms),
    });
  return Response.json({
    ok: true,
    dryRun: true,
    verdict: effectiveVerdict,
    plan,
    creatorAlertRequired:
      contextualOverride?.creatorAlertRequired ?? false,
    contentPersisted: false,
    telegramActionExecuted: false,
  });
}
