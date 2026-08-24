export type ModerationRule =
  | "community_norm_violation"
  | "admin_impersonation_scam"
  | "heated_conflict"
  | "continued_conflict"
  | "crypto_scam"
  | "suspicious_link"
  | "repeated_link"
  | "referral_spam"
  | "excessive_caps"
  | "emoji_spam"
  | "repeated_message"
  | "credible_threat"
  | "harassment_or_bullying"
  | "hate_speech"
  | "nsfw_text"
  | "nsfw_media"
  | "doxxing";

export type ModerationSeverity = "none" | "low" | "medium" | "high" | "severe";

export type ModerationVerdict = {
  flagged: boolean;
  rules: ModerationRule[];
  severity: ModerationSeverity;
  confidence: number;
  reason: string;
  containsLink: boolean;
  immediateDeleteRecommended: boolean;
  primaryTopic: string;
  detector: "deterministic" | "minds_contextual" | "hybrid";
  evidence: string[];
};

export type ContextualSafetyIntent =
  | "benign"
  | "scam_social_engineering"
  | "heated_argument"
  | "continued_conflict"
  | "other_violation"
  | "uncertain";

export type ContextualSafetyAssessment = {
  intent: ContextualSafetyIntent;
  confidence: number;
  evidence: string[];
};

export type AutoModerationPolicy = {
  enabled: boolean;
  warnFirstOffense: boolean;
  deleteObviousSpam: boolean;
  deleteNsfw: boolean;
  muteSecondOffenseSeconds: number;
  autoBanOnThirdOrSevere: boolean;
};

export type PlannedModerationAction = {
  action: "none" | "warn" | "delete" | "mute" | "ban" | "route_to_human";
  automatic: boolean;
  durationSeconds: number | null;
  reason: string;
};

export const DEFAULT_AUTO_MODERATION_POLICY: AutoModerationPolicy = {
  enabled: true,
  warnFirstOffense: true,
  deleteObviousSpam: true,
  deleteNsfw: true,
  muteSecondOffenseSeconds: 3_600,
  autoBanOnThirdOrSevere: false,
};

const urlPattern = /\bhttps?:\/\/[^\s<>]+|\b(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s<>]*)?/giu;
const shortenerPattern = /\b(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rb\.gy|is\.gd|shorturl\.at)\b/iu;
const riskyTldPattern = /\.(?:click|top|xyz|live|win|loan|zip|mov)(?:\/|\b)/iu;
const cryptoScamPattern = /\b(?:connect\s+(?:your\s+)?wallet|validate\s+(?:your\s+)?wallet|wallet\s+verification|seed\s+phrase|recovery\s+phrase|private\s+key|claim\s+(?:your\s+)?(?:airdrop|tokens?)|guaranteed\s+(?:profit|returns?)|double\s+your\s+(?:crypto|money)|wallet\s+drainer|send\s+\w+\s+to\s+receive\s+\w+)\b/iu;
const referralPattern = /(?:[?&](?:ref|referral|invite|affiliate)=|\b(?:referral|invite)\s*(?:code|link)\b|\buse\s+(?:my\s+)?code\b)/iu;
const threatPattern = /\b(?:i(?:'ll|\s+will)\s+(?:kill|hurt|attack)|we(?:'ll|\s+will)\s+(?:kill|hurt|attack)|you\s+(?:should|will)\s+die|kill\s+yourself|i\s+know\s+where\s+you\s+live)\b/iu;
const harassmentPattern = /\b(?:worthless|nobody\s+wants\s+you|keep\s+crying|go\s+die|stupid\s+(?:idiot|loser)|shut\s+up\s+you)\b/iu;
const hatePattern = /\b(?:racial\s+slur|ethnic\s+cleansing|inferior\s+race|all\s+\w+\s+should\s+be\s+(?:killed|removed))\b/iu;
const nsfwPattern = /\b(?:explicit\s+nudes?|send\s+nudes?|porn(?:ography)?|sexual\s+content|onlyfans\s+leak|nsfw\s+drop)\b/iu;
const doxxingPattern = /\b(?:home\s+address|leak(?:ed|ing)?\s+(?:their|his|her|your)\s+(?:address|phone|email)|doxx?(?:ed|ing)?|here\s+is\s+(?:their|his|her)\s+(?:number|address))\b/iu;

const severityRank: Record<ModerationSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  severe: 4,
};

function highestSeverity(values: ModerationSeverity[]) {
  return values.reduce<ModerationSeverity>(
    (highest, current) =>
      severityRank[current] > severityRank[highest] ? current : highest,
    "none",
  );
}

function letterStats(text: string) {
  const letters = Array.from(text).filter((character) => /\p{L}/u.test(character));
  const upper = letters.filter(
    (character) =>
      character === character.toLocaleUpperCase() &&
      character !== character.toLocaleLowerCase(),
  );
  return { total: letters.length, upper: upper.length };
}

function emojiCount(text: string) {
  return Array.from(text.matchAll(/\p{Extended_Pictographic}/gu)).length;
}

export function inferPrimaryTopic(text: string) {
  const normalized = text.toLowerCase();
  const topics: Array<[string, RegExp]> = [
    ["giveaway", /\b(?:giveaway|prize|winner)\b/u],
    ["event", /\b(?:event|space|ama|meetup|workshop)\b/u],
    ["roles", /\b(?:role|contributor|moderator|ambassador)\b/u],
    ["support", /\b(?:help|issue|problem|support|how\s+do)\b/u],
    ["web3", /\b(?:wallet|token|blockchain|crypto|nft|dao|airdrop)\b/u],
    ["announcement", /\b(?:announcement|important\s+update)\b/u],
  ];
  return topics.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "general";
}

export function detectModerationSignals(input: {
  text: string;
  priorMatchingMessages?: number;
}): ModerationVerdict {
  const text = input.text.normalize("NFKC").trim();
  const urls = text.match(urlPattern) ?? [];
  const rules: ModerationRule[] = [];
  const severities: ModerationSeverity[] = [];
  const confidences: number[] = [];

  const add = (
    rule: ModerationRule,
    severity: ModerationSeverity,
    confidence: number,
  ) => {
    if (rules.includes(rule)) return;
    rules.push(rule);
    severities.push(severity);
    confidences.push(confidence);
  };

  if (cryptoScamPattern.test(text)) add("crypto_scam", "severe", 0.98);
  if (
    urls.some((url) => shortenerPattern.test(url) || riskyTldPattern.test(url)) &&
    /\b(?:claim|wallet|verify|urgent|bonus|airdrop|free|token)\b/iu.test(text)
  ) {
    add("suspicious_link", "high", 0.93);
  }
  if (urls.length >= 3) add("repeated_link", "medium", 0.92);
  if (referralPattern.test(text)) add("referral_spam", "medium", 0.88);

  const letters = letterStats(text);
  if (letters.total >= 16 && letters.upper / letters.total >= 0.78) {
    add("excessive_caps", "low", 0.84);
  }
  if (emojiCount(text) >= 12) add("emoji_spam", "low", 0.86);
  if ((input.priorMatchingMessages ?? 0) >= 2) {
    add("repeated_message", "medium", 0.96);
  }

  if (threatPattern.test(text)) add("credible_threat", "severe", 0.97);
  if (harassmentPattern.test(text)) add("harassment_or_bullying", "high", 0.9);
  if (hatePattern.test(text)) add("hate_speech", "severe", 0.95);
  if (nsfwPattern.test(text)) add("nsfw_text", "high", 0.94);
  if (doxxingPattern.test(text)) add("doxxing", "severe", 0.97);

  const severity = highestSeverity(severities);
  const confidence = confidences.length ? Math.max(...confidences) : 0;
  const immediateDeleteRecommended = rules.some((rule) =>
    [
      "crypto_scam",
      "suspicious_link",
      "nsfw_text",
      "doxxing",
      "credible_threat",
      "hate_speech",
    ].includes(rule),
  );

  return {
    flagged: rules.length > 0,
    rules,
    severity,
    confidence,
    reason: rules.length
      ? `Matched ${rules.join(", ")}`
      : "No deterministic high-confidence violation detected",
    containsLink: urls.length > 0,
    immediateDeleteRecommended,
    primaryTopic: inferPrimaryTopic(text),
    detector: "deterministic",
    evidence: rules.map((rule) => `Deterministic signal: ${rule}`),
  };
}

export function planContextualSafetyOverride(input: {
  deterministicVerdict: ModerationVerdict;
  safetyAssessment: ContextualSafetyAssessment;
  adminIdentity: {
    checked: boolean;
    senderIsAdministrator: boolean;
    hasStrongIdentitySimilarity: boolean;
    identityConfidence: number;
    evidence: string[];
  } | null;
  priorOffenses: number;
}): {
  verdict: ModerationVerdict;
  plan: PlannedModerationAction[];
  creatorAlertRequired: boolean;
} | null {
  const confidence = Math.min(
    Math.max(input.safetyAssessment.confidence, 0),
    1,
  );
  const identityConfidence = Math.min(
    Math.max(input.adminIdentity?.identityConfidence ?? 0, 0),
    1,
  );
  const contextualEvidence = Array.from(
    new Set([
      ...(input.adminIdentity?.evidence ?? []),
      ...input.safetyAssessment.evidence,
    ]),
  ).slice(0, 12);
  const highConfidenceImpersonationScam = Boolean(
    input.adminIdentity?.checked &&
      !input.adminIdentity.senderIsAdministrator &&
      input.adminIdentity.hasStrongIdentitySimilarity &&
      input.safetyAssessment.intent === "scam_social_engineering" &&
      confidence >= 0.92 &&
      identityConfidence >= 0.88,
  );

  if (highConfidenceImpersonationScam) {
    const reason =
      "FairTurn verified administrator identity resemblance and high-confidence scam intent.";
    return {
      verdict: {
        ...input.deterministicVerdict,
        flagged: true,
        rules: Array.from(
          new Set([
            ...input.deterministicVerdict.rules,
            "admin_impersonation_scam" as const,
          ]),
        ),
        severity: "severe",
        confidence: Math.min(confidence, identityConfidence),
        reason,
        immediateDeleteRecommended: true,
        detector: "hybrid",
        evidence: contextualEvidence,
      },
      plan: [
        {
          action: "delete",
          automatic: true,
          durationSeconds: null,
          reason,
        },
        {
          action: "mute",
          automatic: true,
          durationSeconds: 0,
          reason,
        },
      ],
      creatorAlertRequired: true,
    };
  }

  if (
    input.safetyAssessment.intent === "continued_conflict" &&
    confidence >= 0.9 &&
    input.priorOffenses >= 1
  ) {
    const reason =
      "The member continued a hostile argument after FairTurn's earlier intervention.";
    return {
      verdict: {
        ...input.deterministicVerdict,
        flagged: true,
        rules: Array.from(
          new Set([
            ...input.deterministicVerdict.rules,
            "continued_conflict" as const,
          ]),
        ),
        severity: "high",
        confidence,
        reason,
        immediateDeleteRecommended: false,
        detector: "minds_contextual",
        evidence: input.safetyAssessment.evidence.slice(0, 12),
      },
      plan: [
        {
          action: "mute",
          automatic: true,
          durationSeconds: 3_600,
          reason,
        },
      ],
      creatorAlertRequired: false,
    };
  }

  if (
    input.safetyAssessment.intent === "heated_argument" &&
    confidence >= 0.85
  ) {
    const reason =
      "This conversation is becoming hostile. Pause the argument and continue respectfully.";
    return {
      verdict: {
        ...input.deterministicVerdict,
        flagged: true,
        rules: Array.from(
          new Set([
            ...input.deterministicVerdict.rules,
            "heated_conflict" as const,
          ]),
        ),
        severity: "medium",
        confidence,
        reason,
        immediateDeleteRecommended: false,
        detector: "minds_contextual",
        evidence: input.safetyAssessment.evidence.slice(0, 12),
      },
      plan: [
        {
          action: "warn",
          automatic: true,
          durationSeconds: null,
          reason,
        },
      ],
      creatorAlertRequired: false,
    };
  }

  return null;
}

export function normalizeAutoModerationPolicy(
  communityNorms: unknown,
): AutoModerationPolicy {
  if (!communityNorms || typeof communityNorms !== "object") {
    return DEFAULT_AUTO_MODERATION_POLICY;
  }
  const root = communityNorms as Record<string, unknown>;
  const candidate =
    root.automatic_moderation &&
    typeof root.automatic_moderation === "object" &&
    !Array.isArray(root.automatic_moderation)
      ? (root.automatic_moderation as Record<string, unknown>)
      : {};
  const seconds = Number(candidate.mute_second_offense_seconds);
  return {
    enabled: candidate.enabled !== false,
    warnFirstOffense: candidate.warn_first_offense !== false,
    deleteObviousSpam: candidate.delete_obvious_spam !== false,
    deleteNsfw: candidate.delete_nsfw !== false,
    muteSecondOffenseSeconds: Number.isFinite(seconds)
      ? Math.min(Math.max(Math.floor(seconds), 30), 86_400)
      : 3_600,
    autoBanOnThirdOrSevere:
      candidate.auto_ban_on_third_or_severe === true,
  };
}

export function planModerationActions(input: {
  verdict: ModerationVerdict;
  priorOffenses: number;
  policy: AutoModerationPolicy;
  mindMediaAssessment?: "none" | "safe" | "nsfw" | "uncertain";
  mindMediaConfidence?: number;
}): PlannedModerationAction[] {
  const mediaNsfw =
    input.mindMediaAssessment === "nsfw" &&
    (input.mindMediaConfidence ?? 0) >= 0.9;
  if (!input.verdict.flagged && !mediaNsfw) {
    return [
      {
        action: "none",
        automatic: true,
        durationSeconds: null,
        reason: "No actionable violation",
      },
    ];
  }

  const offenseNumber = input.priorOffenses + 1;
  const reason = mediaNsfw
    ? "High-confidence NSFW media assessment"
    : input.verdict.reason;
  const actions: PlannedModerationAction[] = [];
  const shouldDelete =
    (mediaNsfw && input.policy.deleteNsfw) ||
    (input.verdict.immediateDeleteRecommended &&
      input.policy.deleteObviousSpam &&
      input.verdict.confidence >= 0.9);

  if (input.policy.enabled && shouldDelete) {
    actions.push({
      action: "delete",
      automatic: true,
      durationSeconds: null,
      reason,
    });
  }

  if (!input.policy.enabled) {
    actions.push({
      action: "route_to_human",
      automatic: false,
      durationSeconds: null,
      reason,
    });
    return actions;
  }

  if (input.verdict.severity === "severe" || mediaNsfw) {
    actions.push({
      action: input.policy.autoBanOnThirdOrSevere ? "ban" : "route_to_human",
      automatic: input.policy.autoBanOnThirdOrSevere,
      durationSeconds: null,
      reason,
    });
  } else if (offenseNumber === 1 && input.policy.warnFirstOffense) {
    actions.push({
      action: "warn",
      automatic: true,
      durationSeconds: null,
      reason,
    });
  } else if (offenseNumber === 2) {
    actions.push({
      action: "mute",
      automatic: true,
      durationSeconds: input.policy.muteSecondOffenseSeconds,
      reason,
    });
  } else if (offenseNumber >= 3) {
    actions.push({
      action: input.policy.autoBanOnThirdOrSevere ? "ban" : "route_to_human",
      automatic: input.policy.autoBanOnThirdOrSevere,
      durationSeconds: null,
      reason,
    });
  }

  return actions.length
    ? actions
    : [
        {
          action: "route_to_human",
          automatic: false,
          durationSeconds: null,
          reason,
        },
      ];
}

export async function contentFingerprint(text: string) {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
