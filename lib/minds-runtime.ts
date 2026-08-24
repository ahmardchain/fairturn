import {
  createMindsClient,
  MindsApiError,
  type BuilderMind,
} from "@animocabrands/minds-client-lib";
import { getRuntimeEnv } from "./runtime-env";

export type FairTurnMindStatusCode =
  | "not_configured"
  | "connected"
  | "disabled"
  | "cognition_depleted"
  | "invalid_credentials"
  | "mind_not_found"
  | "unavailable";

export type FairTurnMindIdentity = {
  mindId: string;
  name: string | null;
  email: string | null;
  model: string | null;
  species: string | null;
  enabled: boolean;
};

export type FairTurnMindConnection = {
  configured: boolean;
  connected: boolean;
  operational: boolean;
  status: FairTurnMindStatusCode;
  identity: FairTurnMindIdentity | null;
  cognitionRemaining: number | null;
  checkedAt: string | null;
  errorCode: string | null;
};

type CachedMindConnection = {
  apiKey: string;
  mindId: string;
  expiresAt: number;
  value: Promise<FairTurnMindConnection>;
};

const MINDS_STATUS_CACHE_MS = 60_000;
let cachedConnection: CachedMindConnection | null = null;

function publicIdentity(mind: BuilderMind): FairTurnMindIdentity {
  return {
    mindId: mind.mindId,
    name: mind.name?.trim() || null,
    email: mind.email?.trim() || null,
    model: mind.model?.trim() || null,
    species: mind.species?.trim() || null,
    enabled: mind.isEnabled !== false,
  };
}

function classifyMindsError(error: unknown): {
  status: FairTurnMindStatusCode;
  errorCode: string;
} {
  if (error instanceof MindsApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: "invalid_credentials",
        errorCode: error.code || "invalid_builder_api_key",
      };
    }
    if (error.status === 404) {
      return {
        status: "mind_not_found",
        errorCode: error.code || "mind_not_found",
      };
    }
    return {
      status: "unavailable",
      errorCode: error.code || `minds_http_${error.status}`,
    };
  }
  return { status: "unavailable", errorCode: "minds_api_unavailable" };
}

async function inspectConfiguredMind(input: {
  apiKey: string;
  mindId: string;
}): Promise<FairTurnMindConnection> {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const client = createMindsClient({ builderApiKey: input.apiKey });
    const [mind, balance] = await Promise.all([
      client.getMind(input.mindId, controller.signal),
      client.getCognitionBalance(input.mindId, controller.signal),
    ]);
    const identity = publicIdentity(mind);
    if (identity.mindId !== input.mindId) {
      return {
        configured: true,
        connected: false,
        operational: false,
        status: "mind_not_found",
        identity: null,
        cognitionRemaining: null,
        checkedAt,
        errorCode: "mind_identity_mismatch",
      };
    }

    const cognitionRemaining = Number.isFinite(balance.cognition)
      ? Math.max(0, balance.cognition)
      : 0;
    if (!identity.enabled) {
      return {
        configured: true,
        connected: true,
        operational: false,
        status: "disabled",
        identity,
        cognitionRemaining,
        checkedAt,
        errorCode: "mind_disabled",
      };
    }
    if (cognitionRemaining <= 0) {
      return {
        configured: true,
        connected: true,
        operational: false,
        status: "cognition_depleted",
        identity,
        cognitionRemaining,
        checkedAt,
        errorCode: "mind_cognition_depleted",
      };
    }

    return {
      configured: true,
      connected: true,
      operational: true,
      status: "connected",
      identity,
      cognitionRemaining,
      checkedAt,
      errorCode: null,
    };
  } catch (error) {
    const classified = classifyMindsError(error);
    return {
      configured: true,
      connected: false,
      operational: false,
      status: classified.status,
      identity: null,
      cognitionRemaining: null,
      checkedAt,
      errorCode: classified.errorCode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getFairTurnMindConnection(options?: {
  force?: boolean;
}): Promise<FairTurnMindConnection> {
  const runtime = await getRuntimeEnv();
  const apiKey = runtime.MINDS_BUILDER_API_KEY?.trim() ?? "";
  const mindId = runtime.MINDS_MIND_ID?.trim() ?? "";
  if (!apiKey || !mindId) {
    return {
      configured: false,
      connected: false,
      operational: false,
      status: "not_configured",
      identity: null,
      cognitionRemaining: null,
      checkedAt: null,
      errorCode: "missing_minds_runtime",
    };
  }

  const now = Date.now();
  if (
    !options?.force &&
    cachedConnection &&
    cachedConnection.apiKey === apiKey &&
    cachedConnection.mindId === mindId &&
    cachedConnection.expiresAt > now
  ) {
    return cachedConnection.value;
  }

  const value = inspectConfiguredMind({ apiKey, mindId });
  cachedConnection = {
    apiKey,
    mindId,
    expiresAt: now + MINDS_STATUS_CACHE_MS,
    value,
  };
  return value;
}
