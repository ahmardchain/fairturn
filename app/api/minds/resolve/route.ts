import { resolveWithFairTurnMind } from "../../../../lib/minds";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

export async function POST(request: Request) {
  const runtime = await getRuntimeEnv();
  if (!runtime.ADMIN_ACTION_SECRET) {
    return Response.json(
      { error: "The FairTurn operator route is not configured" },
      { status: 503 },
    );
  }
  if (
    request.headers.get("x-fairturn-admin-secret") !==
    runtime.ADMIN_ACTION_SECRET
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    message?: string;
    context?: Record<string, unknown> & { conversationKey?: string };
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const message = payload.message?.trim() ?? "";
  const conversationKey = payload.context?.conversationKey?.trim() ?? "";
  if (!message || message.length > 6_000) {
    return Response.json(
      { error: "message is required and must be at most 6,000 characters" },
      { status: 400 },
    );
  }
  if (!conversationKey || conversationKey.length > 200) {
    return Response.json(
      {
        error:
          "context.conversationKey is required and must be at most 200 characters",
      },
      { status: 400 },
    );
  }

  const resolution = await resolveWithFairTurnMind(message, payload.context);
  return Response.json({
    resolution,
    verifiedMindIdentity: resolution.mindIdentity,
    disclosure:
      resolution.mode === "mind"
        ? "Resolved by the configured FairTurn Mind."
        : "Resolved by the deterministic safety fallback; no live Mind result was used.",
  });
}
