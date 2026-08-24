export const triageCategories = [
  "safety_escalation",
  "business_proposal",
  "speaking_invite",
  "member_question",
  "low_priority",
] as const;

export type TriageCategory = (typeof triageCategories)[number];

export function isTriageCategory(value: string): value is TriageCategory {
  return triageCategories.includes(value as TriageCategory);
}

export type TriageResult = {
  summary: string;
  category: TriageCategory;
  urgency: "urgent" | "today" | "later";
  riskLevel: "high" | "medium" | "low";
  requiresApproval: boolean;
  estimatedValue: string | null;
  suggestedAction: string;
  evidence: string[];
};

const safetyTerms = [
  "threat",
  "harass",
  "dox",
  "violent",
  "violence",
  "scam",
  "impersonat",
  "unsafe",
  "blackmail",
];

const businessTerms = [
  "proposal",
  "partnership",
  "sponsor",
  "campaign",
  "collab",
  "budget",
  "paid",
  "brand deal",
];

const speakingTerms = ["speaker", "speaking", "panel", "conference", "keynote"];

export function redactMessage(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSummary(value: string) {
  const redacted = redactMessage(value);
  return redacted.length <= 240 ? redacted : `${redacted.slice(0, 237)}…`;
}

function findEstimatedValue(value: string) {
  const match = value.match(
    /(?:US\$|USD|\$|€|EUR|£|GBP|₦|NGN)\s?\d[\d,.]*(?:\s?[kKmM])?/,
  );
  return match?.[0] ?? null;
}

export function triageMessage(value: string): TriageResult {
  const normalized = value.toLowerCase();
  const safetyMatches = safetyTerms.filter((term) => normalized.includes(term));
  const businessMatches = businessTerms.filter((term) => normalized.includes(term));
  const speakingMatches = speakingTerms.filter((term) => normalized.includes(term));
  const estimatedValue = findEstimatedValue(value);

  if (safetyMatches.length > 0) {
    return {
      summary: compactSummary(value),
      category: "safety_escalation",
      urgency: "urgent",
      riskLevel: "high",
      requiresApproval: true,
      estimatedValue: null,
      suggestedAction: "Route to an eligible safety moderator without exposing excluded content.",
      evidence: safetyMatches.slice(0, 3).map((term) => `Matched safety signal: ${term}`),
    };
  }

  if (speakingMatches.length > 0) {
    return {
      summary: compactSummary(value),
      category: "speaking_invite",
      urgency: "today",
      riskLevel: "low",
      requiresApproval: true,
      estimatedValue,
      suggestedAction: "Prepare an availability-check draft for creator approval.",
      evidence: speakingMatches.slice(0, 3).map((term) => `Matched invitation signal: ${term}`),
    };
  }

  if (businessMatches.length > 0 || estimatedValue) {
    return {
      summary: compactSummary(value),
      category: "business_proposal",
      urgency: estimatedValue ? "urgent" : "today",
      riskLevel: "medium",
      requiresApproval: true,
      estimatedValue,
      suggestedAction: "Draft a reply, but require the creator to approve every commitment.",
      evidence: [
        ...businessMatches.slice(0, 2).map((term) => `Matched business signal: ${term}`),
        ...(estimatedValue ? [`Detected stated value: ${estimatedValue}`] : []),
      ],
    };
  }

  const looksPromotional = /(airdrop|presale|100x|guaranteed return|buy now)/i.test(value);
  return {
    summary: compactSummary(value),
    category: looksPromotional ? "low_priority" : "member_question",
    urgency: "later",
    riskLevel: "low",
    requiresApproval: !looksPromotional,
    estimatedValue: null,
    suggestedAction: looksPromotional
      ? "Keep out of the priority queue; do not reply automatically."
      : "Queue for the next community support rotation.",
    evidence: [looksPromotional ? "Matched low-value promotional pattern" : "No high-risk or commercial signal detected"],
  };
}
