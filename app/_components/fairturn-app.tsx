"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentStudio } from "./agent-studio";
import {
  detectUserTimeZone,
  listWorldTimeZones,
  readPreferredTimeZone,
  savePreferredTimeZone,
  timeZoneDisplayLabel,
} from "../../lib/client-preferences";

type Tab =
  | "overview"
  | "inbox"
  | "pact"
  | "huddle"
  | "studio"
  | "audit"
  | "settings";

type StudioEntry = "home" | "access" | "automation";

type InboxItem = {
  id: string;
  sender: string;
  initials: string;
  message: string;
  category: string;
  value?: string;
  urgency: "urgent" | "today" | "later";
  status: string;
  accent: string;
  live?: boolean;
  agentName?: string;
};

type CommunityHealthStatus = "healthy" | "watch" | "attention" | "new";

type CommunityHealthGroup = {
  id: string;
  name: string;
  chatId: string;
  managedBotId: string;
  agentName: string;
  agentUsername: string | null;
  agentActive: boolean;
  healthScore: number | null;
  healthStatus: CommunityHealthStatus;
  healthReason: string;
  memberCount: number;
  messages7d: number;
  flagged7d: number;
  actionsHandled7d: number;
  pendingActions: number;
  activeAutomations: number;
  lastActivityAt: string | null;
};

type CommunityDashboard = {
  updatedAt: string;
  summary: {
    connectedGroups: number;
    healthyGroups: number;
    needsAttention: number;
    actionsHandled7d: number;
  };
  groups: CommunityHealthGroup[];
};

const inboxSeed: InboxItem[] = [
  {
    id: "1",
    sender: "OrbitX Labs",
    initials: "OX",
    message:
      "Paid partnership for the Protocol Stories series. Can we discuss a 3-video package?",
    category: "Business proposal",
    value: "$2,500",
    urgency: "urgent",
    status: "Reply ready",
    accent: "leaf",
  },
  {
    id: "2",
    sender: "Nadia · Community",
    initials: "NA",
    message:
      "A member sent a graphic threat after I removed a scam link. I need help now.",
    category: "Safety escalation",
    urgency: "urgent",
    status: "Needs routing",
    accent: "coral",
  },
  {
    id: "3",
    sender: "Build Asia",
    initials: "BA",
    message:
      "Invitation to speak in Hong Kong about creator-owned communities next month.",
    category: "Speaking invite",
    urgency: "today",
    status: "Review today",
    accent: "mint",
  },
  {
    id: "4",
    sender: "Kofi Mensah",
    initials: "KM",
    message: "Can you check whether this token-gated workshop link is genuine?",
    category: "Member question",
    urgency: "later",
    status: "Queued",
    accent: "lime",
  },
];

const mobileTabs: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Home", icon: "home" },
  { id: "studio", label: "Agent", icon: "spark" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const FAIRTURN_GROUP_ADMIN_LINK =
  "https://t.me/fairturn_demo_bot?startgroup=fairturn_setup&admin=delete_messages+restrict_members+invite_users+pin_messages+manage_topics+manage_chat";

function openTelegramDestination(url: string) {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(url);
    return;
  }
  window.location.assign(url);
}

const iconPaths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h5v-6h4v6h5V10" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 4h16v13H4z" />
        <path d="M4 13h4l2 3h4l2-3h4" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 5 6v5c0 4.7 2.8 8.3 7 10 4.2-1.7 7-5.3 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z" />
        <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8" />
        <path d="M10 20h4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M14 7l5 5-5 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    telegram: <path d="m21 4-3 16-6-4-3 3v-5l9-7-11 6-4-2 18-7Z" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z" />
      </>
    ),
    chevronRight: <path d="m9 5 7 7-7 7" />,
    chevronDown: <path d="m5 9 7 7 7-7" />,
    more: (
      <>
        <circle cx="12" cy="5" r="1.35" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
        <circle cx="12" cy="19" r="1.35" fill="currentColor" stroke="none" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 6v5h-5" />
        <path d="M4 18v-5h5" />
        <path d="M6.1 9A7 7 0 0 1 18 7l2 4M18 15a7 7 0 0 1-11.9 2L4 13" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name] ?? iconPaths.spark}
    </svg>
  );
}

export function FairTurnApp() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [studioLaunch, setStudioLaunch] = useState<{
    screen: StudioEntry;
    key: number;
  }>({ screen: "home", key: 0 });
  const [inbox, setInbox] = useState(inboxSeed);
  const [pactApproved, setPactApproved] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [integrations, setIntegrations] = useState({
    telegram: false,
    minds: false,
    supabaseMemory: false,
  });
  const [inboxMode, setInboxMode] = useState<
    "demo" | "loading" | "live" | "unavailable"
  >("demo");
  const [notice, setNotice] = useState<string | null>(null);

  const mobileActiveTab: Tab =
    activeTab === "pact" || activeTab === "audit"
      ? "settings"
      : activeTab === "huddle"
        ? "overview"
        : activeTab;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.integrations) {
          setIntegrations({
            telegram: Boolean(payload.integrations.telegram),
            minds: Boolean(payload.integrations.minds),
            supabaseMemory: Boolean(payload.integrations.supabaseMemory),
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const loadScoutInbox = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      setInboxMode("demo");
      return;
    }

    setInboxMode("loading");
    try {
      const response = await fetch("/api/inbox", {
        headers: { "x-telegram-init-data": initData },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        items?: Array<{
          id: string;
          sender: string;
          summary: string;
          category: string;
          urgency: "urgent" | "today" | "later";
          estimatedValue?: string | null;
          status: string;
          agentName?: string;
        }>;
      };
      if (!response.ok) throw new Error(payload.error ?? "FairTurn inbox unavailable");

      const liveItems: InboxItem[] = (payload.items ?? []).map((item) => {
        const initials = item.sender
          .split(/\s+/u)
          .slice(0, 2)
          .map((part) => part[0] ?? "")
          .join("")
          .toUpperCase();
        return {
          id: item.id,
          sender: item.sender,
          initials: initials || "TG",
          message: item.summary,
          category: item.category.replaceAll("_", " "),
          value: item.estimatedValue ?? undefined,
          urgency: item.urgency,
          status: item.status.replaceAll("_", " "),
          accent:
            item.category === "safety_escalation"
              ? "coral"
              : item.category === "business_proposal"
                ? "leaf"
                : "mint",
          live: true,
          agentName: item.agentName ?? "FairTurn",
        };
      });
      setInbox(liveItems);
      setInboxMode("live");
    } catch {
      setInboxMode("unavailable");
    }
  }, []);

  useEffect(() => {
    const refresh = window.setTimeout(() => void loadScoutInbox(), 0);
    return () => window.clearTimeout(refresh);
  }, [loadScoutInbox]);

  useEffect(() => {
    if (!privacyOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPrivacyOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [privacyOpen]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function updateItem(id: string, status: string, message: string) {
    setInbox((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    setNotice(message);
  }

  function openStudio(screen: StudioEntry) {
    setStudioLaunch((current) => ({ screen, key: current.key + 1 }));
    setActiveTab("studio");
  }

  return (
    <div className={`app-shell app-shell-${mobileActiveTab}`}>
      <div className={`workspace-main ${activeTab === "settings" ? "settings-active" : ""}`}>
        <main className={`content ${activeTab === "studio" ? "studio-content" : ""} ${activeTab === "settings" ? "settings-content" : ""}`}>
          {activeTab === "overview" && (
            <Overview onOpenStudio={openStudio} />
          )}
          {activeTab === "inbox" && (
            <InboxView
              inbox={inbox}
              mode={inboxMode}
              onRefresh={loadScoutInbox}
              onUpdate={updateItem}
            />
          )}
          {activeTab === "pact" && (
            <PactView
              approved={pactApproved}
              onApprove={() => {
                setPactApproved(true);
                setNotice(
                  "Pact v4 approved — every moderator will be asked to reconfirm",
                );
              }}
            />
          )}
          {activeTab === "huddle" && (
            <HuddleView
              onApprove={() => {
                setPactApproved(true);
                setNotice("Clarification approved and recorded in Pact v4");
                setActiveTab("pact");
              }}
            />
          )}
          {activeTab === "studio" && (
            <AgentStudio
              key={studioLaunch.key}
              initialScreen={studioLaunch.screen}
              integrationStatus={integrations}
              onNotice={setNotice}
            />
          )}
          {activeTab === "audit" && <AuditView onOpenPrivacy={() => setPrivacyOpen(true)} />}
          {activeTab === "settings" && (
            <SettingsView
              integrations={integrations}
              onNavigate={setActiveTab}
            />
          )}
        </main>
      </div>

      {notice ? <div className="app-toast" role="status">{notice}</div> : null}

      <nav className="mobile-main-nav" aria-label="FairTurn mobile navigation">
        {mobileTabs.map((tab) => (
          <button
            className={mobileActiveTab === tab.id ? "active" : ""}
            aria-current={mobileActiveTab === tab.id ? "page" : undefined}
            key={tab.id}
            onClick={() => {
              setPrivacyOpen(false);
              if (tab.id === "studio") openStudio("home");
              else setActiveTab(tab.id);
            }}
          >
            <span className="mobile-nav-icon"><Icon name={tab.icon} size={22} /></span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {privacyOpen && (
        <PrivacyModal onClose={() => setPrivacyOpen(false)} />
      )}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {action}
    </div>
  );
}

function Overview({
  onOpenStudio,
}: {
  onOpenStudio: (screen: StudioEntry) => void;
}) {
  const [mode, setMode] = useState<"loading" | "ready" | "outside" | "error">(
    "loading",
  );
  const [dashboard, setDashboard] = useState<CommunityDashboard | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [firstName, setFirstName] = useState("");

  const loadDashboard = useCallback(async (quiet = false) => {
    const webApp = window.Telegram?.WebApp;
    const initData = webApp?.initData ?? "";
    setFirstName(webApp?.initDataUnsafe?.user?.first_name?.trim() ?? "");
    if (!initData) {
      setMode("outside");
      return;
    }

    if (quiet) setRefreshing(true);
    else setMode("loading");
    try {
      const response = await fetch("/api/community/dashboard", {
        headers: { "x-telegram-init-data": initData },
        cache: "no-store",
      });
      const payload = (await response.json()) as CommunityDashboard & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Community dashboard is unavailable");
      }
      setDashboard(payload);
      setMode("ready");
    } catch {
      if (!quiet) setMode("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadDashboard]);

  useEffect(() => {
    if (mode !== "ready") return;
    const interval = window.setInterval(() => void loadDashboard(true), 30_000);
    return () => window.clearInterval(interval);
  }, [loadDashboard, mode]);

  const summary = dashboard?.summary ?? {
    connectedGroups: 0,
    healthyGroups: 0,
    needsAttention: 0,
    actionsHandled7d: 0,
  };

  return (
    <section className="live-home" aria-labelledby="live-home-title">
      <header className="live-home-header">
        <div>
          <span className={`live-connection-badge ${mode}`}>
            <i />
            {mode === "ready" ? "Live from Telegram" : "FairTurn live"}
          </span>
          <h1 id="live-home-title">
            {firstName ? `${firstName}’s communities` : "Your Telegram communities"}
          </h1>
          <p>Every group FairTurn is in, with real moderation health from the last 7 days.</p>
        </div>
        <button
          className={`live-refresh-button ${refreshing ? "refreshing" : ""}`}
          onClick={() => void loadDashboard(true)}
          disabled={mode === "loading" || mode === "outside"}
          aria-label="Refresh group health"
        >
          <Icon name="refresh" size={20} />
        </button>
      </header>

      <dl className="community-summary-grid" aria-label="Community summary">
        <div>
          <dt>Groups</dt>
          <dd>{summary.connectedGroups}</dd>
        </div>
        <div>
          <dt>Healthy</dt>
          <dd>{summary.healthyGroups}</dd>
        </div>
        <div className={summary.needsAttention > 0 ? "needs-attention" : ""}>
          <dt>Need review</dt>
          <dd>{summary.needsAttention}</dd>
        </div>
        <div>
          <dt>Actions · 7d</dt>
          <dd>{summary.actionsHandled7d}</dd>
        </div>
      </dl>

      <section className="home-feature-section live-quick-actions" aria-labelledby="home-feature-title">
        <div className="home-feature-heading">
          <div>
            <span>Quick setup</span>
            <h2 id="home-feature-title">Put FairTurn to work</h2>
          </div>
          <small>2 actions</small>
        </div>

        <div className="home-feature-grid">
          <button
            className="home-feature-image-card"
            onClick={() => openTelegramDestination(FAIRTURN_GROUP_ADMIN_LINK)}
            aria-label="Add a FairTurn bot to a Telegram group"
          >
            <img
              src="/fairturn-group-card.png?v=transparent-1"
              alt="Add a bot to a group — moderate your Telegram community, block spam, and enforce your rules"
              width="1536"
              height="1164"
            />
          </button>

          <button
            className="home-feature-image-card"
            onClick={() => onOpenStudio("automation")}
            aria-label="Set up FairTurn inbox automation"
          >
            <img
              src="/fairturn-inbox-card.png?v=transparent-1"
              alt="Automate your inbox — let FairTurn reply to your messages and manage selected chats"
              width="1536"
              height="1082"
            />
          </button>
        </div>
      </section>

      <div className="community-section-heading">
        <div>
          <span>Group health</span>
          <h2>Groups FairTurn manages</h2>
        </div>
        <button onClick={() => onOpenStudio("access")}>
          <span>+</span> Add group
        </button>
      </div>

      {mode === "loading" ? (
        <div className="community-loading" aria-live="polite">
          <article /><article /><article />
          <span>Checking your connected groups…</span>
        </div>
      ) : mode === "outside" ? (
        <article className="community-state-card">
          <span><Icon name="telegram" size={28} /></span>
          <h3>Open FairTurn inside Telegram</h3>
          <p>Your group list is private and appears only after Telegram verifies your account.</p>
          <button onClick={() => onOpenStudio("access")}>How to add a group</button>
        </article>
      ) : mode === "error" ? (
        <article className="community-state-card error">
          <span><Icon name="refresh" size={27} /></span>
          <h3>Couldn’t refresh group health</h3>
          <p>Your groups were not changed. Check the connection and try again.</p>
          <button onClick={() => void loadDashboard()}>Try again</button>
        </article>
      ) : dashboard?.groups.length ? (
        <div className="community-health-list">
          {dashboard.groups.map((group) => (
            <CommunityHealthCard
              group={group}
              key={group.id}
              onManage={() => onOpenStudio("access")}
            />
          ))}
        </div>
      ) : (
        <article className="community-state-card empty">
          <span><Icon name="shield" size={28} /></span>
          <h3>No groups connected yet</h3>
          <p>Add FairTurn as a Telegram group admin. The group and its health will appear here automatically.</p>
          <button onClick={() => onOpenStudio("access")}>Add your first group</button>
        </article>
      )}

      {mode === "ready" && dashboard ? (
        <p className="community-updated-at">
          Auto-refreshes every 30 seconds · Updated {formatRelativeTime(dashboard.updatedAt)}
        </p>
      ) : null}
    </section>
  );
}

function CommunityHealthCard({
  group,
  onManage,
}: {
  group: CommunityHealthGroup;
  onManage: () => void;
}) {
  const initials = group.name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  const statusLabel: Record<CommunityHealthStatus, string> = {
    healthy: "Healthy",
    watch: "Watch",
    attention: "Needs attention",
    new: "New",
  };

  return (
    <article className={`community-health-card ${group.healthStatus}`}>
      <header>
        <span className="community-avatar">{initials || "TG"}</span>
        <div className="community-identity">
          <h3>{group.name}</h3>
          <p>
            {group.agentUsername ? `@${group.agentUsername}` : group.agentName}
            <span>·</span>
            {group.agentActive ? "Moderation on" : "Reconnect agent"}
          </p>
        </div>
        <span className={`community-health-pill ${group.healthStatus}`}>
          <i />
          {statusLabel[group.healthStatus]}
          {group.healthScore === null ? "" : ` · ${group.healthScore}`}
        </span>
      </header>

      <div className="community-health-meter" aria-hidden="true">
        <span style={{ width: `${group.healthScore ?? 8}%` }} />
      </div>

      <dl className="community-card-metrics">
        <div><dt>Members</dt><dd>{group.memberCount}</dd></div>
        <div><dt>Messages</dt><dd>{group.messages7d}</dd></div>
        <div><dt>Flagged</dt><dd>{group.flagged7d}</dd></div>
        <div><dt>Handled</dt><dd>{group.actionsHandled7d}</dd></div>
      </dl>

      <div className="community-health-reason">
        <span><Icon name="shield" size={18} /></span>
        <p><strong>{group.healthReason}</strong><small>{group.activeAutomations} active {group.activeAutomations === 1 ? "automation" : "automations"} · {formatLastActivity(group.lastActivityAt)}</small></p>
      </div>

      <button className="community-manage-button" onClick={onManage}>
        Manage group <Icon name="chevronRight" size={17} />
      </button>
    </article>
  );
}

function formatRelativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatLastActivity(value: string | null) {
  return value ? `Last activity ${formatRelativeTime(value)}` : "No activity yet";
}

function InboxView({
  inbox,
  mode,
  onRefresh,
  onUpdate,
}: {
  inbox: InboxItem[];
  mode: "demo" | "loading" | "live" | "unavailable";
  onRefresh: () => Promise<void>;
  onUpdate: (id: string, status: string, message: string) => void;
}) {
  const [filter, setFilter] = useState("All priority");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const visible =
    filter === "All priority"
      ? inbox
      : inbox.filter(
          (item) =>
            item.category.includes(filter) ||
            (filter === "Opportunities" && Boolean(item.value)) ||
            (filter === "Safety" && item.category === "Safety escalation"),
        );

  return (
    <>
      <PageIntro
        eyebrow="Creator inbox · FairTurn"
        title="The messages worth your time."
        description="Permissioned triage for selected Telegram chats. FairTurn summarizes; you decide what gets sent."
        action={
          <button
            className="primary-btn"
            disabled={mode === "loading"}
            onClick={() => void onRefresh()}
          >
            <Icon name="refresh" />
            {mode === "loading" ? "Checking FairTurn…" : "Check inbox"}
          </button>
        }
      />
      <div className="demo-disclosure">
        <Icon name="lock" size={17} />
        <span>
          <strong>{mode === "live" ? "Live FairTurn summaries." : mode === "unavailable" ? "FairTurn is unavailable." : "Demo data only."}</strong>{" "}
          {mode === "live"
            ? "Only chats selected in Telegram Business appear here. Raw message content is not retained."
            : "Open FairTurn in Telegram and connect your agent to selected Business chats."}
        </span>
      </div>
      <section className="inbox-layout">
        <article className="panel inbox-panel">
          <div className="filter-row">
            {["All priority", "Opportunities", "Safety"].map((item) => (
              <button
                key={item}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
            <span>{visible.length} shown</span>
          </div>
          <div className="message-list">
            {mode === "live" && visible.length === 0 ? (
              <div className="live-inbox-empty">
                <Icon name="inbox" size={24} />
                <strong>No priority FairTurn summaries yet</strong>
                <span>New messages appear after Telegram Business sends them to your connected FairTurn agent.</span>
              </div>
            ) : null}
            {visible.map((item) => (
              <article className="message-row" key={item.id}>
                <span className={`avatar large ${item.accent}-avatar`}>
                  {item.initials}
                </span>
                <div className="message-body">
                  <div>
                    <strong>{item.sender}</strong>
                    <span className={`urgency ${item.urgency}`}>
                      {item.urgency}
                    </span>
                    {item.value && <b>{item.value}</b>}
                  </div>
                  <p>{item.message}</p>
                  <small>{item.category} · {item.live ? `redacted by ${item.agentName}` : "summary generated for this demo"}</small>
                </div>
                <div className="message-action">
                  <span>{item.status}</span>
                  {item.live && item.status !== "replied" ? (
                    <div className="live-reply-composer">
                      <textarea
                        aria-label={`Reply to ${item.sender}`}
                        maxLength={1500}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder="Write the reply FairTurn should send…"
                        rows={3}
                        value={drafts[item.id] ?? ""}
                      />
                      <button
                        disabled={sending === item.id || !(drafts[item.id] ?? "").trim()}
                        onClick={async () => {
                          const initData = window.Telegram?.WebApp?.initData ?? "";
                          if (!initData) {
                            onUpdate(item.id, item.status, "Open FairTurn inside Telegram to approve a reply");
                            return;
                          }
                          setSending(item.id);
                          try {
                            const response = await fetch("/api/telegram/reply", {
                              method: "POST",
                              headers: {
                                "content-type": "application/json",
                                "x-telegram-init-data": initData,
                              },
                              body: JSON.stringify({
                                itemId: item.id,
                                text: drafts[item.id],
                                approved: true,
                              }),
                            });
                            const payload = (await response.json()) as { error?: string };
                            if (!response.ok) throw new Error(payload.error ?? "Reply failed");
                            onUpdate(item.id, "replied", "FairTurn sent your approved Telegram Business reply");
                          } catch (error) {
                            onUpdate(
                              item.id,
                              item.status,
                              error instanceof Error ? error.message : "FairTurn could not send this reply",
                            );
                          } finally {
                            setSending(null);
                          }
                        }}
                      >
                        {sending === item.id ? "Sending…" : "Approve & send"}
                      </button>
                    </div>
                  ) : null}
                  {item.id === "1" && !item.live && (
                    <button
                      onClick={() =>
                        onUpdate(
                          "1",
                          "Done · approved",
                          "Reply approved — delivery is simulated in this demo",
                        )
                      }
                    >
                      {item.status.startsWith("Done") ? "Approved" : "Approve reply"}
                    </button>
                  )}
                  {item.id === "2" && !item.live && (
                    <button
                      onClick={() =>
                        onUpdate(
                          "2",
                          "Routed to David",
                          "Safety case routed — Maya’s boundary remains protected",
                        )
                      }
                    >
                      {item.status.startsWith("Routed") ? "Routed" : "Route safely"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </article>
        <aside className="panel assistant-panel">
          <span className="agent-orb"><Icon name="spark" size={22} /></span>
          <p>FairTurn’s briefing</p>
          <h2>One opportunity could have been missed.</h2>
          <div className="briefing-stat">
            <strong>$2.5k</strong>
            <span>estimated proposal value</span>
          </div>
          <p className="muted">
            OrbitX’s message arrived between 47 token promotions. FairTurn ranked
            it first because it contains a clear budget, deliverable, and deadline.
          </p>
          <div className="guardrail">
            <Icon name="shield" size={17} />
            <span>Financial commitments always require your approval.</span>
          </div>
        </aside>
      </section>
    </>
  );
}

function PactView({ approved, onApprove }: { approved: boolean; onApprove: () => void }) {
  const moderators = [
    {
      name: "Amara",
      role: "Community lead",
      initials: "AM",
      color: "leaf",
      capacity: 64,
      boundary: "No assignments after 20:00 UTC",
    },
    {
      name: "David",
      role: "Safety moderator",
      initials: "DA",
      color: "mint",
      capacity: 42,
      boundary: "Available for high-risk escalations",
    },
    {
      name: "Maya",
      role: "Conversation moderator",
      initials: "MY",
      color: "coral",
      capacity: 71,
      boundary: "No graphic threats or harassment evidence",
    },
  ];

  return (
    <>
      <PageIntro
        eyebrow="Moderator pact · Version 4"
        title="Boundaries are infrastructure."
        description="A living agreement that keeps the work fair, explicit, and safe for every moderator."
        action={
          <button
            className={approved ? "approved-btn" : "primary-btn"}
            onClick={onApprove}
            disabled={approved}
          >
            <Icon name="check" />
            {approved ? "Pact v4 active" : "Approve Pact v4"}
          </button>
        }
      />
      <section className="pact-banner">
        <div>
          <span className="agent-orb"><Icon name="spark" /></span>
          <p>
            <strong>FairTurn suggested one clarification</strong>
            <span>
              Define “graphic content” before the next rotation so Maya’s
              exclusion is applied consistently.
            </span>
          </p>
        </div>
        <span className="mini-label coral">Human approval required</span>
      </section>
      <section className="moderator-grid">
        {moderators.map((person) => (
          <article className="panel moderator-card" key={person.name}>
            <div className="moderator-head">
              <span className={`avatar large ${person.color}-avatar`}>
                {person.initials}
              </span>
              <div><h2>{person.name}</h2><p>{person.role}</p></div>
              <span className="active-status">Active</span>
            </div>
            <div className="capacity-label">
              <span>Current capacity</span><b>{person.capacity}%</b>
            </div>
            <div className="capacity-track"><span style={{ width: `${person.capacity}%` }} /></div>
            <div className="boundary-box">
              <Icon name="shield" size={16} />
              <p><small>Protected boundary</small><strong>{person.boundary}</strong></p>
            </div>
          </article>
        ))}
      </section>
      <section className="panel pact-rules">
        <div className="panel-heading">
          <div><p>Shared rules</p><h2>What FairTurn may do</h2></div>
          <span className="privacy-badge"><Icon name="history" size={14} />Reconfirm every 30 days</span>
        </div>
        <div className="rules-grid">
          <div><Icon name="check" /><p><strong>Assign routine cases</strong><span>Within stated capacity and exclusions</span></p></div>
          <div><Icon name="check" /><p><strong>Draft member replies</strong><span>Never send sensitive replies autonomously</span></p></div>
          <div><Icon name="check" /><p><strong>Schedule follow-ups</strong><span>Retain outcome, not raw conversation</span></p></div>
          <div className="rule-blocked"><Icon name="close" /><p><strong>No irreversible action</strong><span>Bans, payments, and public statements need approval</span></p></div>
        </div>
      </section>
    </>
  );
}

function HuddleView({ onApprove }: { onApprove: () => void }) {
  return (
    <>
      <PageIntro
        eyebrow="Decision huddle · 1 open"
        title="Turn disagreement into a better rule."
        description="FairTurn preserves the reasoning, not just the final vote."
      />
      <section className="huddle-layout">
        <article className="panel huddle-thread">
          <div className="thread-context">
            <span className="mini-label coral">Boundary conflict</span>
            <h2>What counts as “graphic content”?</h2>
            <p>
              A report includes a written threat but no image. Maya’s boundary
              currently excludes “graphic threats.”
            </p>
          </div>
          <div className="thread-message">
            <span className="avatar leaf-avatar">AM</span>
            <div><p><strong>Amara</strong><small>10:14</small></p><span>The intent was to protect Maya from reviewing visual evidence and explicit descriptions, not every threat report.</span></div>
          </div>
          <div className="thread-message">
            <span className="avatar mint-avatar">DA</span>
            <div><p><strong>David</strong><small>10:18</small></p><span>Agree, but the agent should route ambiguous cases to me first. We should not infer consent.</span></div>
          </div>
          <div className="thread-message agent-message">
            <span className="avatar lime-avatar">FT</span>
            <div><p><strong>FairTurn</strong><small>Suggested clarification</small></p><span>“Maya will not receive visual evidence, explicit descriptions of violence, or ambiguous threat cases. Route those to David unless he is unavailable.”</span></div>
          </div>
        </article>
        <aside className="panel decision-card">
          <span className="mini-label lime">Ready to decide</span>
          <h2>Proposed Pact v4 update</h2>
          <p>Clarifies one phrase, adds an ambiguity fallback, and changes no other permissions.</p>
          <div className="decision-check"><Icon name="check" /><span>All 3 moderators were heard</span></div>
          <div className="decision-check"><Icon name="check" /><span>Safest interpretation preserved</span></div>
          <div className="decision-check"><Icon name="check" /><span>Reversible for 7 days</span></div>
          <button className="primary-btn full-btn" onClick={onApprove}>Approve clarification <Icon name="arrow" /></button>
          <small>Approval is recorded in the audit trail.</small>
        </aside>
      </section>
    </>
  );
}

function AuditView({ onOpenPrivacy }: { onOpenPrivacy: () => void }) {
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const entries = [
    { time: "10:18", title: "Boundary conflict opened", detail: "Maya’s exclusion matched an ambiguous safety report.", color: "coral" },
    { time: "09:42", title: "Opportunity surfaced", detail: "OrbitX proposal ranked above 47 promotional DMs.", color: "leaf" },
    { time: "Yesterday", title: "Follow-up completed", detail: "Member confirmed the impersonation report was resolved.", color: "lime" },
    { time: "19 Aug", title: "Pact consent renewed", detail: "All three moderators reconfirmed their permissions.", color: "mint" },
  ];

  function exportAudit() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            workspace: "Creator Commons demo",
            disclosure: "Simulated audit data",
            rawPrivateMessagesIncluded: false,
            events: entries,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "fairturn-demo-audit.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageIntro
        eyebrow="Memory & audit"
        title="Useful memory, without surveillance."
        description="Every consequential suggestion has a source, an approver, and an expiry."
        action={<button className="outline-btn" onClick={exportAudit}><Icon name="lock" />Export audit</button>}
      />
      <section className="audit-grid">
        <article className="panel audit-list">
          <div className="panel-heading"><div><p>Decision trail</p><h2>Recent events</h2></div><span className="privacy-badge">30-day window</span></div>
          {entries.map((entry) => (
            <div className={`audit-entry ${selectedEntry === entry.title ? "selected" : ""}`} key={entry.title}>
              <span className={`audit-dot ${entry.color}-bg`} />
              <time>{entry.time}</time>
              <p><strong>{entry.title}</strong><span>{entry.detail}</span></p>
              <button
                aria-label={`Inspect ${entry.title}`}
                aria-pressed={selectedEntry === entry.title}
                onClick={() => setSelectedEntry(entry.title)}
              ><Icon name="arrow" size={16} /></button>
            </div>
          ))}
        </article>
        <aside className="panel retention-card">
          <span className="card-icon lime-icon"><Icon name="lock" /></span>
          <h2>Retention by design</h2>
          <p>FairTurn stores the minimum needed to close a loop and explain a decision.</p>
          <div><span>Raw DM content</span><strong>Not retained</strong></div>
          <div><span>Encrypted summaries</span><strong>30 days</strong></div>
          <div><span>Decision outcomes</span><strong>Until deleted</strong></div>
          <div><span>Moderator boundaries</span><strong>Until revoked</strong></div>
          <button className="outline-btn" onClick={onOpenPrivacy}>Manage retention</button>
        </aside>
      </section>
    </>
  );
}

function SettingsView({
  integrations,
  onNavigate,
}: {
  integrations: { telegram: boolean; minds: boolean; supabaseMemory: boolean };
  onNavigate: (tab: Tab) => void;
}) {
  const [timezone, setTimezone] = useState(() => readPreferredTimeZone());
  const [detectedTimezone] = useState(() => detectUserTimeZone());
  const [timezoneOptions] = useState(() => listWorldTimeZones());
  const [telegramUser] = useState(() => {
    const fallback = {
      id: "Unavailable",
      name: "Telegram user",
      username: "Open FairTurn inside Telegram",
      initials: "FT",
      photoUrl: "",
    };
    if (typeof window === "undefined") return fallback;

    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (!user) return fallback;

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const initials = [user.first_name, user.last_name]
      .filter(Boolean)
      .map((part) => part?.slice(0, 1).toUpperCase())
      .join("")
      .slice(0, 2);
    let photoUrl = "";
    try {
      const parsedPhoto = user.photo_url ? new URL(user.photo_url) : null;
      photoUrl = parsedPhoto?.protocol === "https:" ? parsedPhoto.toString() : "";
    } catch {
      photoUrl = "";
    }

    return {
      id: String(user.id),
      name: name || "Telegram user",
      username: user.username ? `@${user.username}` : "No public username",
      initials: initials || "TG",
      photoUrl,
    };
  });

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
  }, []);

  function updateTimezone(nextTimezone: string) {
    setTimezone(nextTimezone);
    savePreferredTimeZone(nextTimezone);
  }

  return (
    <section className="account-settings-screen" aria-label="FairTurn settings">
      <div className="account-settings-body">
        <section className="account-profile-card" aria-label="Telegram profile">
          <span
            aria-label={telegramUser.photoUrl ? `${telegramUser.name} Telegram profile picture` : undefined}
            className={`account-profile-avatar${telegramUser.photoUrl ? " has-photo" : ""}`}
            role={telegramUser.photoUrl ? "img" : undefined}
            style={telegramUser.photoUrl ? { backgroundImage: `url(${telegramUser.photoUrl})` } : undefined}
          >
            {telegramUser.photoUrl ? null : telegramUser.initials}
          </span>
          <span className="account-profile-details">
            <strong>{telegramUser.name}</strong>
            <small>{telegramUser.username}</small>
            <small className="account-profile-id">Telegram ID · {telegramUser.id}</small>
          </span>
        </section>

        <div className="account-preferences-card">
          <div className="account-preference-row">
            <span>Language</span>
            <span className="settings-static-value">
              English <small>MVP</small>
            </span>
          </div>
          <label>
            <span>
              Timezone
              <small className="timezone-detection-note">
                {timezone === detectedTimezone ? "Detected automatically" : "Custom selection"}
              </small>
            </span>
            <span className="settings-select-wrap">
              <select value={timezone} onChange={(event) => updateTimezone(event.target.value)} aria-label="Timezone">
                {timezoneOptions.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>
                    {timeZoneDisplayLabel(timeZone)}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={17} />
            </span>
          </label>
        </div>

        <p className="account-settings-label">Sign-in methods</p>
        <button className="account-telegram-card" onClick={() => onNavigate("studio")}>
          <span className="account-telegram-icon"><Icon name="telegram" size={24} /></span>
          <span>
            <strong>Telegram</strong>
            <small>{telegramUser.username}{integrations.telegram ? " · connected" : ""}</small>
          </span>
        </button>

        <div className="account-links-card">
          <button onClick={() => onNavigate("studio")}><span>Credits</span><Icon name="chevronRight" size={20} /></button>
          <button className="coming-soon-row" type="button" disabled>
            <span>Support</span>
            <small>Coming soon</small>
          </button>
        </div>

        <div className="account-social-links" aria-label="FairTurn links">
          <a href="https://t.me/Ahmardchain" target="_blank" rel="noreferrer" aria-label="Telegram"><Icon name="telegram" size={24} /></a>
          <a href="https://fairturn.ahmardchain.chatgpt.site" target="_blank" rel="noreferrer" aria-label="FairTurn website"><Icon name="globe" size={24} /></a>
          <a href="https://x.com/Ahmardchain" target="_blank" rel="noreferrer" aria-label="X"><span aria-hidden="true">X</span></a>
        </div>
        <p className="account-version">v0.9.0 · Telegram Mini App</p>
      </div>
    </section>
  );
}

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="privacy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
        aria-describedby="privacy-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close privacy controls" autoFocus><Icon name="close" /></button>
        <span className="privacy-hero-icon"><Icon name="lock" size={25} /></span>
        <p>Privacy centre</p>
        <h2 id="privacy-title">You choose what FairTurn can see.</h2>
        <span id="privacy-description">FairTurn works only in chats you explicitly select. It sees only groups where it is installed and permitted.</span>
        <div className="privacy-options">
          <div><Icon name="telegram" /><p><strong>Selected Telegram chats</strong><span>FairTurn can see only chats shared in Telegram Business</span></p><b>Opt-in</b></div>
          <div><Icon name="history" /><p><strong>Summary retention</strong><span>Delete automatically after 30 days</span></p><b>30d</b></div>
          <div><Icon name="shield" /><p><strong>Sensitive actions</strong><span>Always require a human approval</span></p><b>On</b></div>
        </div>
        <button className="primary-btn full-btn" onClick={onClose}>Done</button>
        <small>FairTurn does not claim end-to-end encryption inside Telegram; data is encrypted in transit and at rest when live integrations are configured.</small>
      </section>
    </div>
  );
}
