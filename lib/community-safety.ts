import { telegramBotApi } from "./managed-bots";

type TelegramIdentityUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramChatAdministrator = {
  status?: string;
  user: TelegramIdentityUser;
};

type TelegramProfilePhotos = {
  photos: Array<
    Array<{
      file_id: string;
      file_unique_id?: string;
      width: number;
      height: number;
    }>
  >;
};

export type AdminIdentityMatch = {
  adminUserId: string;
  adminDisplayName: string;
  adminUsername: string | null;
  matchedSignals: Array<"display_name" | "username" | "profile_photo">;
  displayNameSimilarity: number;
  usernameSimilarity: number;
  exactProfilePhotoMatch: boolean;
};

export type AdminIdentityContext = {
  checked: boolean;
  senderIsAdministrator: boolean;
  senderUserId: string;
  senderDisplayName: string;
  senderUsername: string | null;
  adminCount: number;
  closestAdmin: AdminIdentityMatch | null;
  hasStrongIdentitySimilarity: boolean;
  identityConfidence: number;
  evidence: string[];
};

type CachedAdmin = {
  user: TelegramIdentityUser;
  displayName: string;
  username: string | null;
  profilePhotoFileUniqueId: string | null;
};

const adminSnapshotCache = new Map<
  string,
  { expiresAt: number; admins: CachedAdmin[] }
>();

const confusableCharacters: Record<string, string> = {
  "а": "a",
  "е": "e",
  "о": "o",
  "р": "p",
  "с": "c",
  "у": "y",
  "х": "x",
  "і": "i",
  "ј": "j",
  "ѕ": "s",
  "ӏ": "l",
  "ɑ": "a",
  "ο": "o",
  "ρ": "p",
  "ν": "v",
  "κ": "k",
};

function displayName(user: TelegramIdentityUser) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || "Member";
}

export function identitySkeleton(value: string) {
  return Array.from(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLocaleLowerCase(),
  )
    .map((character) => confusableCharacters[character] ?? character)
    .join("")
    .replace(/[\p{P}\p{S}\p{Z}\u200B-\u200D\u2060\uFEFF]/gu, "");
}

function editDistance(left: string, right: string) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

export function identitySimilarity(left: string, right: string) {
  const normalizedLeft = identitySkeleton(left);
  const normalizedRight = identitySkeleton(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  return Math.max(0, 1 - editDistance(normalizedLeft, normalizedRight) / longest);
}

async function latestProfilePhotoFileUniqueId(
  token: string,
  userId: number,
) {
  try {
    const result = await telegramBotApi<TelegramProfilePhotos>(
      token,
      "getUserProfilePhotos",
      { user_id: userId, offset: 0, limit: 1 },
    );
    return result.photos[0]?.at(-1)?.file_unique_id ?? null;
  } catch {
    return null;
  }
}

async function getAdminSnapshot(input: {
  token: string;
  chatId: string | number;
}) {
  const key = String(input.chatId);
  const cached = adminSnapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.admins;

  const chatMembers = await telegramBotApi<TelegramChatAdministrator[]>(
    input.token,
    "getChatAdministrators",
    { chat_id: String(input.chatId), return_bots: false },
  );
  const humanAdmins = chatMembers
    .filter((member) => !member.user.is_bot)
    .slice(0, 40);
  const photoIds = await Promise.all(
    humanAdmins.map((member) =>
      latestProfilePhotoFileUniqueId(input.token, member.user.id),
    ),
  );
  const admins = humanAdmins.map((member, index) => ({
    user: member.user,
    displayName: displayName(member.user),
    username: member.user.username ?? null,
    profilePhotoFileUniqueId: photoIds[index] ?? null,
  }));
  adminSnapshotCache.set(key, {
    expiresAt: Date.now() + 5 * 60_000,
    admins,
  });
  return admins;
}

function evidenceForMatch(match: AdminIdentityMatch) {
  const evidence: string[] = [];
  if (match.matchedSignals.includes("display_name")) {
    evidence.push(
      `Display name resembles administrator ${match.adminDisplayName} (${Math.round(match.displayNameSimilarity * 100)}%).`,
    );
  }
  if (match.matchedSignals.includes("username")) {
    evidence.push(
      `Username resembles @${match.adminUsername ?? "unknown"} (${Math.round(match.usernameSimilarity * 100)}%).`,
    );
  }
  if (match.exactProfilePhotoMatch) {
    evidence.push("Telegram reports the same profile-photo file identity as an administrator.");
  }
  return evidence;
}

export async function inspectAdminIdentity(input: {
  token: string;
  chatId: string | number;
  sender: TelegramIdentityUser;
}): Promise<AdminIdentityContext> {
  const senderDisplayName = displayName(input.sender);
  const senderUsername = input.sender.username ?? null;
  try {
    const admins = await getAdminSnapshot(input);
    const senderIsAdministrator = admins.some(
      (admin) => admin.user.id === input.sender.id,
    );
    if (senderIsAdministrator) {
      return {
        checked: true,
        senderIsAdministrator: true,
        senderUserId: String(input.sender.id),
        senderDisplayName,
        senderUsername,
        adminCount: admins.length,
        closestAdmin: null,
        hasStrongIdentitySimilarity: false,
        identityConfidence: 0,
        evidence: ["Sender is a verified Telegram administrator; impersonation shield bypassed."],
      };
    }

    const senderPhoto = await latestProfilePhotoFileUniqueId(
      input.token,
      input.sender.id,
    );
    const candidates = admins.map((admin): AdminIdentityMatch => {
      const displayNameSimilarity = identitySimilarity(
        senderDisplayName,
        admin.displayName,
      );
      const usernameSimilarity =
        senderUsername && admin.username
          ? identitySimilarity(senderUsername, admin.username)
          : 0;
      const exactProfilePhotoMatch = Boolean(
        senderPhoto &&
          admin.profilePhotoFileUniqueId &&
          senderPhoto === admin.profilePhotoFileUniqueId,
      );
      const matchedSignals: AdminIdentityMatch["matchedSignals"] = [];
      if (displayNameSimilarity >= 0.88) matchedSignals.push("display_name");
      if (usernameSimilarity >= 0.82) matchedSignals.push("username");
      if (exactProfilePhotoMatch) matchedSignals.push("profile_photo");
      return {
        adminUserId: String(admin.user.id),
        adminDisplayName: admin.displayName,
        adminUsername: admin.username,
        matchedSignals,
        displayNameSimilarity,
        usernameSimilarity,
        exactProfilePhotoMatch,
      };
    });
    const closestAdmin =
      candidates.sort((left, right) => {
        const leftScore = Math.max(
          left.displayNameSimilarity,
          left.usernameSimilarity,
          left.exactProfilePhotoMatch ? 1 : 0,
        );
        const rightScore = Math.max(
          right.displayNameSimilarity,
          right.usernameSimilarity,
          right.exactProfilePhotoMatch ? 1 : 0,
        );
        return rightScore - leftScore;
      })[0] ?? null;
    const identityConfidence = closestAdmin
      ? Math.max(
          closestAdmin.displayNameSimilarity,
          closestAdmin.usernameSimilarity,
          closestAdmin.exactProfilePhotoMatch ? 1 : 0,
        )
      : 0;
    const hasStrongIdentitySimilarity = Boolean(
      closestAdmin &&
        (closestAdmin.exactProfilePhotoMatch ||
          closestAdmin.displayNameSimilarity >= 0.92 ||
          closestAdmin.usernameSimilarity >= 0.88 ||
          closestAdmin.matchedSignals.length >= 2),
    );
    return {
      checked: true,
      senderIsAdministrator: false,
      senderUserId: String(input.sender.id),
      senderDisplayName,
      senderUsername,
      adminCount: admins.length,
      closestAdmin: hasStrongIdentitySimilarity ? closestAdmin : null,
      hasStrongIdentitySimilarity,
      identityConfidence: hasStrongIdentitySimilarity ? identityConfidence : 0,
      evidence:
        hasStrongIdentitySimilarity && closestAdmin
          ? evidenceForMatch(closestAdmin)
          : ["No strong administrator identity resemblance was verified."],
    };
  } catch {
    return {
      checked: false,
      senderIsAdministrator: false,
      senderUserId: String(input.sender.id),
      senderDisplayName,
      senderUsername,
      adminCount: 0,
      closestAdmin: null,
      hasStrongIdentitySimilarity: false,
      identityConfidence: 0,
      evidence: ["Telegram administrator identity signals were unavailable."],
    };
  }
}
