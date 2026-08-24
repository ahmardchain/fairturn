import { getFairTurnMindConnection } from "../../../../lib/minds-runtime";

export async function GET() {
  const connection = await getFairTurnMindConnection();
  return Response.json(
    {
      product: "FairTurn",
      provider: "Minds by Animoca Brands",
      role: "Core persistent reasoning and assistant runtime",
      ...connection,
      builderApiKeyExposed: false,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
