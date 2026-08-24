import { and, desc, eq, gte } from "drizzle-orm";
import { communityActivity, communityMembers } from "../db/schema";
import { getDb } from "../db";

export type ReportPeriod = "day" | "week" | "month";

const periodMilliseconds: Record<ReportPeriod, number> = {
  day: 24 * 60 * 60 * 1_000,
  week: 7 * 24 * 60 * 60 * 1_000,
  month: 30 * 24 * 60 * 60 * 1_000,
};

export async function generateCommunityReport(input: {
  communityId: string;
  period: ReportPeriod;
}) {
  const db = await getDb();
  const since = new Date(Date.now() - periodMilliseconds[input.period]).toISOString();
  const [events, members] = await Promise.all([
    db
      .select({
        telegramUserId: communityActivity.telegramUserId,
        eventType: communityActivity.eventType,
        primaryTopic: communityActivity.primaryTopic,
        flagged: communityActivity.flagged,
      })
      .from(communityActivity)
      .where(
        and(
          eq(communityActivity.communityId, input.communityId),
          gte(communityActivity.createdAt, since),
        ),
      )
      .orderBy(desc(communityActivity.createdAt))
      .limit(5_000),
    db
      .select({
        telegramUserId: communityMembers.telegramUserId,
        displayAlias: communityMembers.displayAlias,
      })
      .from(communityMembers)
      .where(eq(communityMembers.communityId, input.communityId))
      .limit(5_000),
  ]);

  const aliases = new Map(
    members.map((member) => [member.telegramUserId, member.displayAlias]),
  );
  const contributors = new Map<string, number>();
  const topics = new Map<string, number>();
  let postCount = 0;
  let flaggedCount = 0;
  let joins = 0;

  for (const event of events) {
    if (event.eventType === "message") {
      postCount += 1;
      if (event.telegramUserId) {
        contributors.set(
          event.telegramUserId,
          (contributors.get(event.telegramUserId) ?? 0) + 1,
        );
      }
      if (event.primaryTopic) {
        topics.set(event.primaryTopic, (topics.get(event.primaryTopic) ?? 0) + 1);
      }
    }
    if (event.flagged) flaggedCount += 1;
    if (event.eventType === "join") joins += 1;
  }

  const topContributors = Array.from(contributors.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([telegramUserId, count]) => ({
      telegramUserId,
      displayAlias: aliases.get(telegramUserId) ?? `Member ${telegramUserId}`,
      count,
    }));
  const trendingTopics = Array.from(topics.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  return {
    period: input.period,
    since,
    postCount,
    flaggedCount,
    joins,
    topContributors,
    trendingTopics,
  };
}

export function formatCommunityReport(
  report: Awaited<ReturnType<typeof generateCommunityReport>>,
) {
  const contributorText = report.topContributors.length
    ? report.topContributors
        .map((entry, index) => `${index + 1}. ${entry.displayAlias} — ${entry.count}`)
        .join("\n")
    : "No contributor activity yet.";
  const topicText = report.trendingTopics.length
    ? report.trendingTopics
        .map((entry) => `${entry.topic} (${entry.count})`)
        .join(", ")
    : "No clear trend yet.";
  return [
    `📊 FairTurn ${report.period} community summary`,
    `Posts: ${report.postCount} · Flagged: ${report.flaggedCount} · New members: ${report.joins}`,
    `Top contributors:\n${contributorText}`,
    `Trending topics: ${topicText}`,
  ].join("\n\n");
}

