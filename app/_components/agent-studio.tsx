"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readPreferredTimeZone } from "../../lib/client-preferences";

type StudioScreen =
  | "home"
  | "profile"
  | "access"
  | "automation"
  | "instructions"
  | "memory"
  | "knowledge"
  | "tasks"
  | "newTask"
  | "integrations"
  | "guardrails";

type AgentKind = "guardian" | "scout";
type SubAgentTemplateId =
  | "fairturn"
  | "guardian"
  | "scout"
  | "host"
  | "giveaway"
  | "quiz";
type TaskKind = "post" | "event" | "giveaway" | "quiz";
type ScheduleKind = "once" | "daily" | "weekly";

type CreatorTask = {
  id: string;
  kind: TaskKind;
  name: string;
  prompt: string;
  target: string;
  schedule: ScheduleKind;
  scheduleLabel: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  requiresApproval: boolean;
  targetChatId: string;
  managedBotId: string;
};

type CreatorTaskInput = Omit<CreatorTask, "id" | "enabled">;

type TaskTargetGroup = {
  id: string;
  name: string;
  chatId: string;
  managedBotId: string;
};

type TaskDataState = "checking" | "ready" | "outside" | "error";

type CreatedSubAgent = {
  id: string;
  templateId: SubAgentTemplateId;
  name: string;
  username: string;
  status: string;
  photoDataUrl?: string | null;
};

type PendingSubAgent = {
  id: string;
  name: string;
  username: string;
};

type MainAgentIdentity = {
  name: string;
  username: string | null;
  photoDataUrl: string | null;
};

type AgentMemoryItem = {
  id: string;
  kind: string;
  summary: string;
  createdAt: string;
  expiresAt: string | null;
};

type AgentConfigurationState = "checking" | "ready" | "outside" | "error";

type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
};

type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: { user?: TelegramWebAppUser };
  ready?: () => void;
  openTelegramLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type ToggleState = {
  tagged: boolean;
  replied: boolean;
  relevant: boolean;
  otherBots: boolean;
};

const agents = {
  guardian: {
    name: "Community Guardian",
    shortName: "Guardian",
    label: "Moderation + community assistant",
    description:
      "Moderate Telegram, route safety cases, and run approved posts, events, giveaways, and quizzes.",
    accent: "guardian",
  },
  scout: {
    name: "Scout Inbox Agent",
    shortName: "Scout",
    label: "Private inbox · opt-in",
    description:
      "Find business opportunities and prepare replies inside chats you explicitly select.",
    accent: "scout",
  },
} as const;

const TELEGRAM_BOTFATHER_LINK = "https://t.me/BotFather";

function openTelegramDestination(url: string) {
  if (window.Telegram?.WebApp?.openTelegramLink) {
    window.Telegram.WebApp.openTelegramLink(url);
    return;
  }
  window.location.assign(url);
}

const setupSteps: Array<{
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
  imageClassName?: string;
  trailing?: "arrow" | "copy";
}> = [
  {
    title: "Enable Secretary Mode",
    description:
      "Open this bot's settings and turn on Secretary Mode so it can read and reply in your chats.",
    image: "/inbox-secretary-mode.jpg",
    imageAlt: "Telegram Secretary Mode enabled",
    trailing: "arrow",
  },
  {
    title: "Enable Chat Automation",
    description:
      "In Telegram, go to Settings → Edit (top right) → Chat Automation.",
    image: "/inbox-reference-top.jpg",
    imageAlt: "Telegram Chat Automation setting",
    imageClassName: "chat-automation-crop",
  },
  {
    title: "Add your bot",
    description: "Tap Add, then search and select @fairturn_demo_bot.",
    image: "/inbox-add-fairturn-bot.jpg",
    imageAlt: "Add the FairTurn Demo Bot in Telegram",
    trailing: "copy",
  },
  {
    title: "Choose chats to automate",
    description: "Pick which chats the bot can access and reply in.",
    image: "/inbox-choose-chats.jpg",
    imageAlt: "Choose Telegram chats for FairTurn to automate",
  },
  {
    title: "Customize the agent",
    description:
      "Give your agent instructions on how to handle and reply to your chats.",
    trailing: "arrow",
  },
];

const subAgentTemplates: {
  id: SubAgentTemplateId;
  name: string;
  description: string;
  status: string;
  icon: string;
  tone: string;
  agent: AgentKind;
  screen: StudioScreen;
}[] = [
  {
    id: "fairturn",
    name: "FairTurn",
    description: "Moderation, inbox, knowledge & automations",
    status: "All modules",
    icon: "bot",
    tone: "main",
    agent: "guardian",
    screen: "profile",
  },
  {
    id: "guardian",
    name: "Community Guardian",
    description: "Moderation, spam defense & safety routing",
    status: "Always on",
    icon: "shield",
    tone: "guardian",
    agent: "guardian",
    screen: "profile",
  },
  {
    id: "scout",
    name: "Scout",
    description: "Private inbox triage & creator opportunities",
    status: "Opt-in chats",
    icon: "spark",
    tone: "scout",
    agent: "scout",
    screen: "profile",
  },
  {
    id: "host",
    name: "Community Host",
    description: "Scheduled posts, events & reminders",
    status: "2 tasks active",
    icon: "calendar",
    tone: "host",
    agent: "guardian",
    screen: "tasks",
  },
  {
    id: "giveaway",
    name: "Giveaway Steward",
    description: "Eligibility checks & auditable winner draws",
    status: "Review-gated",
    icon: "gift",
    tone: "giveaway",
    agent: "guardian",
    screen: "tasks",
  },
  {
    id: "quiz",
    name: "Quiz Master",
    description: "Quizzes, polls, answers & results",
    status: "Ready",
    icon: "quiz",
    tone: "quiz",
    agent: "guardian",
    screen: "tasks",
  },
];

const glyphPaths: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h5v-6h4v6h5V10" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="4" />
      <path d="M12 3v4M8 12h.01M16 12h.01M9 16h6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.7 2.8 8.3 7 10 4.2-1.7 7-5.3 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 14h4l2 3h4l2-3h4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  actions: (
    <>
      <path d="M12 3 2.8 19h18.4L12 3Z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" />
      <path d="M9 4v7l3-2 3 2V4M7 16h12" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 4A3 3 0 0 0 5 6.6 3.5 3.5 0 0 0 4 13a3 3 0 0 0 4 4.7A3 3 0 0 0 12 20V7a3 3 0 0 0-2.5-3Z" />
      <path d="M14.5 4A3 3 0 0 1 19 6.6a3.5 3.5 0 0 1 1 6.4 3 3 0 0 1-4 4.7A3 3 0 0 1 12 20V7a3 3 0 0 1 2.5-3Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M9 2h6M12 9v4l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01" />
    </>
  ),
  gift: (
    <>
      <path d="M4 10h16v10H4zM3 7h18v4H3zM12 7v13" />
      <path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7Zm0 0h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9a2.5 2.5 0 1 1 3.8 2.1c-1 .6-1.5 1.1-1.5 2.4M12 17h.01" />
    </>
  ),
  send: (
    <>
      <path d="m21 3-7.5 18-3.2-7.3L3 10.5 21 3Z" />
      <path d="m10.3 13.7 4.5-4.5" />
    </>
  ),
  telegram: <path d="m21 4-3 16-6-4-3 3v-5l9-7-11 6-4-2 18-7Z" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 14.5 21 16l-2 3-2.3-1a8 8 0 0 1-2.2 1.2L14 22h-4l-.5-2.8A8 8 0 0 1 7.3 18L5 19l-2-3 2-1.5a8 8 0 0 1 0-5L3 8l2-3 2.3 1a8 8 0 0 1 2.2-1.2L10 2h4l.5 2.8A8 8 0 0 1 16.7 6L19 5l2 3-2 1.5a8 8 0 0 1 0 5Z" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a5 5 0 0 1 10 0v2M16 5a3 3 0 0 1 0 6M16 14a5 5 0 0 1 5 5v1" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  spark: (
    <>
      <path d="m12 3 1.3 4.2 4.2 1.3-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3L12 3Z" />
      <path d="m18.5 15 .7 2.2 2.3.8-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
};

function StudioGlyph({ name, size = 21 }: { name: string; size?: number }) {
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
      {glyphPaths[name] ?? glyphPaths.spark}
    </svg>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      className={`studio-switch ${checked ? "on" : ""}`}
      onClick={onChange}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span />
    </button>
  );
}

export function AgentStudio({
  onNotice,
  integrationStatus,
  initialScreen = "home",
}: {
  onNotice: (message: string) => void;
  integrationStatus: {
    telegram: boolean;
    minds: boolean;
    supabaseMemory: boolean;
  };
  initialScreen?: "home" | "access" | "automation";
}) {
  const [screen, setScreen] = useState<StudioScreen>(initialScreen);
  const [agent, setAgent] = useState<AgentKind>("guardian");
  const initialAutomationAgentResolved = useRef(false);
  const [activeSubAgentId, setActiveSubAgentId] = useState<string | null>(null);
  const [activeSubAgentName, setActiveSubAgentName] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<SubAgentTemplateId>("fairturn");
  const [createdSubAgents, setCreatedSubAgents] = useState<CreatedSubAgent[]>([]);
  const [pendingSubAgents, setPendingSubAgents] = useState<PendingSubAgent[]>([]);
  const [mainAgentIdentity, setMainAgentIdentity] = useState<MainAgentIdentity>({
    name: "FairTurn",
    username: null,
    photoDataUrl: null,
  });
  const [agentCreationBusy, setAgentCreationBusy] = useState(false);
  const [pollManagedBots, setPollManagedBots] = useState(false);
  const [telegramAgentState, setTelegramAgentState] = useState<
    "checking" | "ready" | "outside" | "error"
  >("checking");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [persona, setPersona] = useState("");
  const [rules, setRules] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [memories, setMemories] = useState<AgentMemoryItem[]>([]);
  const [agentConfigurationState, setAgentConfigurationState] =
    useState<AgentConfigurationState>("checking");
  const [agentConfigurationBusy, setAgentConfigurationBusy] = useState(false);
  const [canWriteMemory, setCanWriteMemory] = useState(false);
  const [creatorTasks, setCreatorTasks] = useState<CreatorTask[]>([]);
  const [taskTargets, setTaskTargets] = useState<TaskTargetGroup[]>([]);
  const [taskDataState, setTaskDataState] = useState<TaskDataState>("checking");
  const [taskBusy, setTaskBusy] = useState(false);
  const [toggles, setToggles] = useState<ToggleState>({
    tagged: true,
    replied: true,
    relevant: false,
    otherBots: false,
  });

  const loadManagedAgents = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      setTelegramAgentState("outside");
      return;
    }

    try {
      const response = await fetch("/api/agents", {
        headers: { "x-telegram-init-data": initData },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Managed agents are unavailable");
      const payload = (await response.json()) as {
        manager?: MainAgentIdentity;
        agents?: CreatedSubAgent[];
        pending?: PendingSubAgent[];
      };
      const validAgents = (payload.agents ?? []).filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.username === "string" &&
          subAgentTemplates.some((template) => template.id === item.templateId),
      );
      setCreatedSubAgents(validAgents.slice(0, 1));
      setMainAgentIdentity({
        name: payload.manager?.name?.trim() || "FairTurn",
        username: payload.manager?.username ?? null,
        photoDataUrl: payload.manager?.photoDataUrl ?? null,
      });
      if (
        initialScreen === "automation" &&
        !initialAutomationAgentResolved.current &&
        validAgents[0]
      ) {
        const selectedAgent = validAgents[0];
        const template = subAgentTemplates.find(
          (item) => item.id === selectedAgent.templateId,
        );
        if (template) {
          initialAutomationAgentResolved.current = true;
          setAgent(template.agent);
          setActiveSubAgentId(selectedAgent.id);
          setActiveSubAgentName(selectedAgent.name);
          setActiveTemplateId(selectedAgent.templateId);
        }
      }
      const validPending = (payload.pending ?? []).filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.username === "string",
      );
      setPendingSubAgents(validPending.slice(0, 1));
      if ((payload.pending?.length ?? 0) === 0) setPollManagedBots(false);
      setTelegramAgentState("ready");
    } catch {
      setTelegramAgentState("error");
    }
  }, [initialScreen]);

  const loadAgentConfiguration = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      setAgentConfigurationState("outside");
      return;
    }

    try {
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const response = await fetch(`/api/agent/settings${selectedAgentQuery}`, {
        headers: { "x-telegram-init-data": initData },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Agent configuration is unavailable");
      const payload = (await response.json()) as {
        settings?: {
          persona?: string;
          rules?: string;
          welcomeMessage?: string;
          accessMode?: string;
          respondWhenTagged?: boolean;
          respondWhenReplied?: boolean;
          respondWhenRelevant?: boolean;
          seeOtherBots?: boolean;
        };
        memories?: AgentMemoryItem[];
        canWriteMemory?: boolean;
      };
      setPersona(payload.settings?.persona ?? "");
      setRules(payload.settings?.rules ?? "");
      setWelcomeMessage(payload.settings?.welcomeMessage ?? "");
      setVisibility(payload.settings?.accessMode === "public" ? "public" : "private");
      setToggles({
        tagged: payload.settings?.respondWhenTagged !== false,
        replied: payload.settings?.respondWhenReplied !== false,
        relevant: payload.settings?.respondWhenRelevant === true,
        otherBots: payload.settings?.seeOtherBots === true,
      });
      setMemories(
        (payload.memories ?? []).filter(
          (memory) =>
            typeof memory.id === "string" &&
            typeof memory.summary === "string" &&
            typeof memory.createdAt === "string",
        ),
      );
      setCanWriteMemory(Boolean(payload.canWriteMemory));
      setAgentConfigurationState("ready");
    } catch {
      setAgentConfigurationState("error");
    }
  }, [activeSubAgentId]);

  const loadCreatorTasks = useCallback(async () => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      setTaskDataState("outside");
      return;
    }

    try {
      const headers = { "x-telegram-init-data": initData };
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const [taskResponse, groupResponse] = await Promise.all([
        fetch(`/api/automations${selectedAgentQuery}`, { headers, cache: "no-store" }),
        fetch(`/api/community/dashboard${selectedAgentQuery}`, { headers, cache: "no-store" }),
      ]);
      if (!taskResponse.ok || !groupResponse.ok) {
        throw new Error("Scheduled tasks are unavailable");
      }
      const taskPayload = (await taskResponse.json()) as {
        automations?: Array<{
          id?: string;
          kind?: string;
          name?: string;
          instruction?: string;
          targetLabel?: string;
          targetChatId?: string | null;
          managedBotId?: string | null;
          scheduleKind?: string;
          cronExpression?: string;
          timezone?: string;
          nextRunAt?: string | null;
          status?: string;
          requiresApproval?: boolean;
        }>;
      };
      const groupPayload = (await groupResponse.json()) as {
        groups?: Array<{
          id?: string;
          name?: string;
          chatId?: string;
          managedBotId?: string;
        }>;
      };
      const validKinds: TaskKind[] = ["post", "event", "giveaway", "quiz"];
      const validSchedules: ScheduleKind[] = ["once", "daily", "weekly"];
      const nextTasks = (taskPayload.automations ?? []).flatMap((task) => {
        if (
          !task.id ||
          !task.name ||
          !task.instruction ||
          !task.kind ||
          !validKinds.includes(task.kind as TaskKind) ||
          !task.scheduleKind ||
          !validSchedules.includes(task.scheduleKind as ScheduleKind) ||
          !task.cronExpression ||
          !task.timezone
        ) {
          return [];
        }
        const schedule = task.scheduleKind as ScheduleKind;
        return [{
          id: task.id,
          kind: task.kind as TaskKind,
          name: task.name,
          prompt: task.instruction,
          target: task.targetLabel || "Telegram group",
          schedule,
          scheduleLabel: describePersistedSchedule({
            schedule,
            cron: task.cronExpression,
            timezone: task.timezone,
            nextRunAt: task.nextRunAt ?? null,
          }),
          cron: task.cronExpression,
          timezone: task.timezone,
          enabled: task.status === "active",
          requiresApproval: task.requiresApproval !== false,
          targetChatId: task.targetChatId ?? "",
          managedBotId: task.managedBotId ?? "",
        } satisfies CreatorTask];
      });
      const nextTargets = (groupPayload.groups ?? []).flatMap((group) =>
        group.id && group.name && group.chatId && group.managedBotId
          ? [{
              id: group.id,
              name: group.name,
              chatId: group.chatId,
              managedBotId: group.managedBotId,
            }]
          : [],
      );
      setCreatorTasks(nextTasks);
      setTaskTargets(nextTargets);
      setTaskDataState("ready");
    } catch {
      setTaskDataState("error");
    }
  }, [activeSubAgentId]);

  useEffect(() => {
    const refresh = () => void loadManagedAgents();
    const initialRefresh = window.setTimeout(refresh, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.Telegram?.WebApp?.onEvent?.("activated", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.Telegram?.WebApp?.offEvent?.("activated", refresh);
    };
  }, [loadManagedAgents]);

  useEffect(() => {
    const refresh = () => void loadAgentConfiguration();
    const initialRefresh = window.setTimeout(refresh, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.Telegram?.WebApp?.onEvent?.("activated", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.Telegram?.WebApp?.offEvent?.("activated", refresh);
    };
  }, [loadAgentConfiguration]);

  useEffect(() => {
    const refresh = () => void loadCreatorTasks();
    const initialRefresh = window.setTimeout(refresh, 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.Telegram?.WebApp?.onEvent?.("activated", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.Telegram?.WebApp?.offEvent?.("activated", refresh);
    };
  }, [loadCreatorTasks]);

  useEffect(() => {
    if (!pollManagedBots) return;
    const interval = window.setInterval(() => void loadManagedAgents(), 2_500);
    const stop = window.setTimeout(() => setPollManagedBots(false), 90_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(stop);
    };
  }, [loadManagedAgents, pollManagedBots]);

  function openAgent(kind: AgentKind) {
    setAgent(kind);
    setActiveSubAgentId(null);
    setActiveSubAgentName(null);
    setActiveTemplateId("fairturn");
    setAgentConfigurationState("checking");
    setTaskDataState("checking");
    setPersona("");
    setRules("");
    setWelcomeMessage("");
    setMemories([]);
    setScreen("profile");
    onNotice(`${agents[kind].name} opened · permissioned configuration`);
  }

  function openSubAgent(
    id: string,
    kind: AgentKind,
    nextScreen: StudioScreen,
    name: string,
    templateId: SubAgentTemplateId,
  ) {
    setAgent(kind);
    setActiveSubAgentId(id);
    setActiveSubAgentName(name);
    setActiveTemplateId(templateId);
    setAgentConfigurationState("checking");
    setTaskDataState("checking");
    setPersona("");
    setRules("");
    setWelcomeMessage("");
    setMemories([]);
    setScreen(nextScreen);
    onNotice(`${name} opened · permissions remain controlled by FairTurn`);
  }

  async function createSubAgent() {
    if (createdSubAgents.length >= 1) {
      onNotice("FairTurn MVP supports one managed agent per Telegram account");
      return;
    }
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn from Telegram to create your managed agent");
      return;
    }

    setAgentCreationBusy(true);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "x-telegram-init-data": initData },
      });
      const payload = (await response.json()) as {
        error?: string;
        deepLink?: string;
      };
      if (!response.ok || !payload.deepLink) {
        throw new Error(payload.error ?? "Telegram could not start bot creation");
      }

      setPollManagedBots(true);
      onNotice("Finish on Telegram’s native Create Bot screen");
      openTelegramDestination(payload.deepLink);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "Telegram could not start bot creation",
      );
    } finally {
      setAgentCreationBusy(false);
    }
  }

  async function persistAccessSettings(
    nextVisibility: "private" | "public",
    nextToggles: ToggleState,
  ) {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to save agent access settings");
      return false;
    }

    try {
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const response = await fetch(`/api/agent/settings${selectedAgentQuery}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          accessMode: nextVisibility,
          respondWhenTagged: nextToggles.tagged,
          respondWhenReplied: nextToggles.replied,
          respondWhenRelevant: nextToggles.relevant,
          seeOtherBots: nextToggles.otherBots,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Agent access settings could not be saved");
      }
      return true;
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "Agent access settings could not be saved",
      );
      return false;
    }
  }

  function changeVisibility(nextVisibility: "private" | "public") {
    const previousVisibility = visibility;
    setVisibility(nextVisibility);
    void persistAccessSettings(nextVisibility, toggles).then((saved) => {
      if (!saved) setVisibility(previousVisibility);
    });
  }

  function updateToggle(key: keyof ToggleState) {
    const previousToggles = toggles;
    const nextToggles = { ...toggles, [key]: !toggles[key] };
    setToggles(nextToggles);
    void persistAccessSettings(visibility, nextToggles).then((saved) => {
      if (!saved) setToggles(previousToggles);
    });
  }

  function openTaskComposer() {
    setScreen("newTask");
  }

  async function addCreatorTask(task: CreatorTaskInput) {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to save a task");
      return false;
    }
    if (taskBusy) return false;

    setTaskBusy(true);
    try {
      const response = await fetch("/api/automations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          kind: task.kind,
          name: task.name,
          instruction: task.prompt,
          targetChatId: task.targetChatId,
          targetLabel: task.target,
          scheduleKind: task.schedule,
          cronExpression: task.cron,
          timezone: task.timezone,
          requiresApproval: task.requiresApproval,
          managedBotId: task.managedBotId,
          configuration: {
            createdConversationally: true,
            taskComposer: "simple_mvp",
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "FairTurn could not save this task");
      }
      await loadCreatorTasks();
      setScreen("tasks");
      onNotice(
        `${task.name} scheduled${task.requiresApproval ? " · human review stays on" : ""}`,
      );
      return true;
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "FairTurn could not save this task",
      );
      return false;
    } finally {
      setTaskBusy(false);
    }
  }

  async function toggleCreatorTask(id: string) {
    const task = creatorTasks.find((item) => item.id === id);
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!task || taskBusy) return;
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to change a task");
      return;
    }

    setTaskBusy(true);
    try {
      const response = await fetch("/api/automations", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({
          id,
          status: task.enabled ? "paused" : "active",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "FairTurn could not update this task");
      }
      setCreatorTasks((current) =>
        current.map((item) =>
          item.id === id ? { ...item, enabled: !item.enabled } : item,
        ),
      );
      onNotice(`${task.name} ${task.enabled ? "paused" : "enabled"}`);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "FairTurn could not update this task",
      );
    } finally {
      setTaskBusy(false);
    }
  }

  async function saveAgentInstructions() {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to save agent instructions");
      return;
    }
    setAgentConfigurationBusy(true);
    try {
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const response = await fetch(`/api/agent/settings${selectedAgentQuery}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ persona, rules, welcomeMessage }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        settings?: { persona?: string; rules?: string; welcomeMessage?: string };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "FairTurn could not save instructions");
      }
      setPersona(payload?.settings?.persona ?? persona.trim());
      setRules(payload?.settings?.rules ?? rules.trim());
      setWelcomeMessage(payload?.settings?.welcomeMessage ?? welcomeMessage.trim());
      setAgentConfigurationState("ready");
      onNotice("FairTurn’s persona and rules are saved");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "FairTurn could not save instructions",
      );
    } finally {
      setAgentConfigurationBusy(false);
    }
  }

  async function addAgentMemory(summary: string) {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to add a memory");
      return false;
    }

    setAgentConfigurationBusy(true);
    try {
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const response = await fetch(`/api/agent/settings${selectedAgentQuery}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ summary }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "FairTurn could not add this memory");
      }
      await loadAgentConfiguration();
      onNotice("Memory added across FairTurn chats");
      return true;
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "FairTurn could not add this memory",
      );
      return false;
    } finally {
      setAgentConfigurationBusy(false);
    }
  }

  async function deleteAgentMemory(memoryId: string) {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      onNotice("Open FairTurn inside Telegram to delete a memory");
      return;
    }

    setAgentConfigurationBusy(true);
    try {
      const selectedAgentQuery = activeSubAgentId
        ? `?agentId=${encodeURIComponent(activeSubAgentId)}`
        : "";
      const response = await fetch(`/api/agent/settings${selectedAgentQuery}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "x-telegram-init-data": initData,
        },
        body: JSON.stringify({ memoryId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "FairTurn could not delete this memory");
      }
      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      onNotice("Memory deleted");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "FairTurn could not delete this memory",
      );
    } finally {
      setAgentConfigurationBusy(false);
    }
  }

  function goBack() {
    if (screen === "newTask") {
      setScreen("tasks");
      return;
    }
    if (["access", "automation", "instructions", "memory", "knowledge", "tasks", "integrations", "guardrails"].includes(screen)) {
      setScreen("profile");
      return;
    }
    setScreen("home");
  }

  return (
    <section className="studio-experience">
      <div className="studio-app">
        <div className="studio-body">
          {screen !== "home" ? (
            <button className="studio-inline-back" onClick={goBack} aria-label="Go back">
              <StudioGlyph name="back" />
            </button>
          ) : null}

          {screen === "home" && (
            <StudioHome
              onOpen={openAgent}
              onOpenSubAgent={openSubAgent}
              onNew={() => void createSubAgent()}
              createdSubAgents={createdSubAgents}
              pendingSubAgents={pendingSubAgents}
              mainAgentIdentity={mainAgentIdentity}
              agentCreationBusy={agentCreationBusy}
              telegramAgentState={telegramAgentState}
            />
          )}

          {screen === "profile" && (
            <AgentProfile
              agent={agent}
              templateId={activeTemplateId}
              displayName={activeSubAgentName ?? undefined}
              isSubAgent={activeSubAgentName !== null}
              onOpen={(nextScreen) => setScreen(nextScreen)}
              onNotice={onNotice}
            />
          )}

          {screen === "access" && (
            <AccessSettings
              agent={agent}
              visibility={visibility}
              onVisibility={changeVisibility}
              toggles={toggles}
              onToggle={updateToggle}
              onNotice={onNotice}
            />
          )}

          {screen === "automation" && (
            activeSubAgentId ? (
              <AutomationSetup
                onEnableSecretaryMode={() =>
                  openTelegramDestination(TELEGRAM_BOTFATHER_LINK)
                }
                onCustomize={() => setScreen("instructions")}
              />
            ) : (
              <div className="automation-screen inbox-automation-screen">
                <div className="inbox-automation-heading">
                  <h2>Inbox automation</h2>
                  <p>Inbox automation belongs to a separate FairTurn subagent, never the main manager bot.</p>
                </div>
                <section className="knowledge-empty-card">
                  <StudioGlyph name="bot" size={26} />
                  <strong>Create your subagent first</strong>
                  <span>FairTurn will manage it, while the subagent handles only the Telegram chats you select.</span>
                  <button type="button" onClick={() => void createSubAgent()} disabled={agentCreationBusy}>
                    {agentCreationBusy ? "Opening Telegram…" : "Create subagent"}
                  </button>
                </section>
              </div>
            )
          )}

          {screen === "tasks" && (
            <CreatorAutomations
              tasks={creatorTasks}
              state={taskDataState}
              busy={taskBusy}
              onToggle={(id) => void toggleCreatorTask(id)}
              onCreate={openTaskComposer}
            />
          )}

          {screen === "knowledge" && (
            <KnowledgeModule
              onNotice={onNotice}
              preferredAgentId={activeSubAgentId}
            />
          )}

          {screen === "newTask" && (
            <NewTaskComposer
              targets={taskTargets}
              state={taskDataState}
              busy={taskBusy}
              onSave={addCreatorTask}
            />
          )}

          {["instructions", "memory", "integrations", "guardrails"].includes(screen) && (
            <ModuleSettings
              screen={screen as Exclude<StudioScreen, "home" | "profile" | "access" | "automation" | "knowledge" | "tasks" | "newTask">}
              persona={persona}
              rules={rules}
              welcomeMessage={welcomeMessage}
              onPersona={setPersona}
              onRules={setRules}
              onWelcomeMessage={setWelcomeMessage}
              onSaveInstructions={() => void saveAgentInstructions()}
              memories={memories}
              configurationState={agentConfigurationState}
              configurationBusy={agentConfigurationBusy}
              canWriteMemory={canWriteMemory}
              onAddMemory={addAgentMemory}
              onDeleteMemory={(memoryId) => void deleteAgentMemory(memoryId)}
              integrationStatus={integrationStatus}
            />
          )}
        </div>

      </div>
    </section>
  );
}

function AgentDirectoryAvatar({
  name,
  photoDataUrl,
  tone,
  main = false,
}: {
  name: string;
  photoDataUrl?: string | null;
  tone: string;
  main?: boolean;
}) {
  const imageUrl = photoDataUrl || null;
  const initial = name.trim().slice(0, 1).toUpperCase() || "A";

  return (
    <span
      className={`agent-directory-avatar ${tone}${imageUrl ? " has-photo" : ""}`}
      aria-label={
        imageUrl
          ? `${name} Telegram profile picture`
          : main
            ? `${name} Telegram profile picture not set`
            : `${name} Telegram profile picture placeholder`
      }
      role="img"
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      {imageUrl || main ? null : initial}
    </span>
  );
}

function StudioHome({
  onOpen,
  onOpenSubAgent,
  onNew,
  createdSubAgents,
  pendingSubAgents,
  mainAgentIdentity,
  agentCreationBusy,
  telegramAgentState,
}: {
  onOpen: (agent: AgentKind) => void;
  onOpenSubAgent: (
    id: string,
    agent: AgentKind,
    screen: StudioScreen,
    name: string,
    templateId: SubAgentTemplateId,
  ) => void;
  onNew: () => void;
  createdSubAgents: CreatedSubAgent[];
  pendingSubAgents: PendingSubAgent[];
  mainAgentIdentity: MainAgentIdentity;
  agentCreationBusy: boolean;
  telegramAgentState: "checking" | "ready" | "outside" | "error";
}) {
  const hasSubAgent = createdSubAgents.length > 0;
  const hasPendingSubAgent = pendingSubAgents.length > 0;

  return (
    <div className="studio-home agents-directory">
      <header
        className="agents-directory-heading"
        aria-label="FairTurn is the manager. Every subagent keeps its own identity and settings."
      >
        <h2>My Agents</h2>
        <div className="agents-directory-actions">
          <button
            disabled={hasSubAgent || agentCreationBusy}
            onClick={onNew}
            title={hasSubAgent ? "MVP limit: one managed agent" : undefined}
          >
            {agentCreationBusy
              ? "Opening…"
              : hasSubAgent
                ? "1 / 1"
                : hasPendingSubAgent
                  ? "Continue"
                  : "+ New"}
          </button>
        </div>
      </header>

      <section className="agent-directory-section">
        <p className="agent-directory-label">My agent</p>
        <button className="main-agent-directory-row" onClick={() => onOpen("guardian")}>
          <AgentDirectoryAvatar
            main
            name="FairTurn"
            photoDataUrl={mainAgentIdentity.photoDataUrl}
            tone="main"
          />
          <span className="agent-directory-copy">
            <strong>FairTurn</strong>
            <small>Main agent</small>
          </span>
          <StudioGlyph name="arrow" size={20} />
        </button>
      </section>

      {telegramAgentState === "outside" ? (
        <div className="agent-telegram-state">
          <StudioGlyph name="telegram" size={18} />
          <p><strong>Open FairTurn inside Telegram</strong><span>Managed agents connect only to your verified Telegram account.</span></p>
        </div>
      ) : telegramAgentState === "error" ? (
        <div className="agent-telegram-state error">
          <StudioGlyph name="shield" size={18} />
          <p><strong>Agent sync needs attention</strong><span>Check the FairTurn bot connection, then reopen this Mini App.</span></p>
        </div>
      ) : null}

      {hasSubAgent || hasPendingSubAgent ? (
        <section className="agent-directory-section subagents-section">
          <p className="agent-directory-label">Sub-agents</p>
          <div className="sub-agent-directory-list">
            {pendingSubAgents.map((pendingAgent) => (
              <div className="sub-agent-directory-row pending" key={pendingAgent.id}>
                <AgentDirectoryAvatar
                  name={pendingAgent.name}
                  tone="pending"
                />
                <span className="agent-directory-copy">
                  <strong>{pendingAgent.name}</strong>
                  <small>Waiting for Telegram…</small>
                </span>
                <StudioGlyph name="arrow" size={19} />
              </div>
            ))}
              {createdSubAgents.map((createdAgent) => {
                const template = subAgentTemplates.find(
                  (item) => item.id === createdAgent.templateId,
                );
                if (!template) return null;
                return (
                  <button
                    key={createdAgent.id}
                    onClick={() =>
                      onOpenSubAgent(
                        createdAgent.id,
                        template.agent,
                        template.screen,
                        createdAgent.name,
                        createdAgent.templateId,
                      )
                    }
                  >
                    <AgentDirectoryAvatar
                      name={createdAgent.name}
                      photoDataUrl={createdAgent.photoDataUrl}
                      tone={template.tone}
                    />
                    <span className="agent-directory-copy">
                      <strong>{createdAgent.name}</strong>
                      <small>@{createdAgent.username}</small>
                    </span>
                    <StudioGlyph name="arrow" size={19} />
                  </button>
                );
              })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AgentProfile({
  agent,
  templateId,
  displayName,
  isSubAgent,
  onOpen,
  onNotice,
}: {
  agent: AgentKind;
  templateId: SubAgentTemplateId;
  displayName?: string;
  isSubAgent: boolean;
  onOpen: (screen: StudioScreen) => void;
  onNotice: (message: string) => void;
}) {
  const current = agents[agent];
  const isUniversal = templateId === "fairturn";
  const profileName = displayName ?? (isUniversal ? "FairTurn" : current.name);
  const generalRows: { screen: StudioScreen; icon: string; label: string; tone: string }[] = [
    { screen: "access", icon: "shield", label: "Access", tone: "purple" },
    ...(isSubAgent
      ? [{ screen: "automation" as const, icon: "inbox", label: "Inbox automation", tone: "green" }]
      : []),
  ];
  const moduleRows: { screen: StudioScreen; icon: string; label: string; tone: string }[] = [
    { screen: "instructions", icon: "book", label: "Instructions", tone: "lavender" },
    { screen: "memory", icon: "brain", label: "Memory", tone: "pink" },
    { screen: "knowledge", icon: "book", label: "Knowledge", tone: "green" },
    {
      screen: "tasks",
      icon: "clock",
      label: "Tasks",
      tone: "coral",
    },
    { screen: "integrations", icon: "link", label: "Integrations", tone: "green" },
    { screen: "guardrails", icon: "shield", label: "Guardrails", tone: "green" },
  ];

  return (
    <div className="agent-profile-screen">
      <div className={`agent-profile-card ${current.accent}`}>
        <span className="large-agent-icon"><StudioGlyph name={isUniversal ? "bot" : agent === "scout" ? "spark" : "shield"} size={31} /></span>
        <div><span>{isSubAgent && isUniversal ? "Moderation · assistant · inbox automation" : isUniversal ? "Moderation · assistant · subagent manager" : current.label}</span><h2>{profileName}</h2><p>{isSubAgent && isUniversal ? "This separate bot can fully moderate and assist, with its own settings, memory, groups, selected inbox chats, knowledge, and tasks." : isUniversal ? "FairTurn fully moderates and assists communities, and creates, configures, connects, monitors, and manages your subagent. Only the subagent can automate your selected personal inbox chats." : current.description}</p></div>
        <span className="agent-online"><i /> Ready</span>
      </div>
      <div className="agent-profile-actions">
        <button onClick={() => onNotice("Profile editor opened · demo mode")}><StudioGlyph name="settings" size={17} />Edit profile</button>
        <button className="open-agent" onClick={() => onNotice(`${profileName} demo opened`)}><StudioGlyph name="arrow" size={17} />Open demo</button>
      </div>
      <SettingsGroup title="General" rows={generalRows} onOpen={onOpen} />
      <SettingsGroup title="Modules" rows={moduleRows} onOpen={onOpen} />
    </div>
  );
}

function SettingsGroup({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: { screen: StudioScreen; icon: string; label: string; tone: string }[];
  onOpen: (screen: StudioScreen) => void;
}) {
  return (
    <section className="studio-settings-group">
      <p>{title}</p>
      <div>
        {rows.map((row) => (
          <button key={row.label} onClick={() => onOpen(row.screen)}>
            <span className={`module-icon ${row.tone}`}><StudioGlyph name={row.icon} /></span>
            <strong>{row.label}</strong>
            <StudioGlyph name="arrow" size={18} />
          </button>
        ))}
      </div>
    </section>
  );
}

function AccessSettings({
  agent,
  visibility,
  onVisibility,
  toggles,
  onToggle,
  onNotice,
}: {
  agent: AgentKind;
  visibility: "private" | "public";
  onVisibility: (mode: "private" | "public") => void;
  toggles: ToggleState;
  onToggle: (key: keyof ToggleState) => void;
  onNotice: (message: string) => void;
}) {
  return (
    <div className="access-screen">
      <div className="screen-title"><span className="module-icon purple"><StudioGlyph name="shield" /></span><div><span>Permissions</span><h2>Who can interact</h2></div></div>
      <section className="dark-settings-card access-card">
        <div className="visibility-toggle" role="group" aria-label="Agent visibility">
          <button className={visibility === "private" ? "active" : ""} onClick={() => onVisibility("private")}>Private</button>
          <button className={visibility === "public" ? "active" : ""} onClick={() => onVisibility("public")}>Public</button>
        </div>
        <button className="access-row" onClick={() => onNotice("Allowed-users editor opened · demo mode")}>
          <span className="module-icon green"><StudioGlyph name="users" /></span>
          <p><strong>Allowed users</strong><small>{visibility === "private" ? "3 people selected" : "Anyone can start"}</small></p>
          <StudioGlyph name="arrow" size={18} />
        </button>
      </section>
      <p className="access-explainer">
        {visibility === "private"
          ? "Private mode: only you and people you explicitly allow can interact with this agent."
          : "Public mode: anyone can start the bot. Sensitive actions still require approval."}
      </p>

      <section className="dark-settings-card response-card">
        <div className="screen-title small"><span className="module-icon green"><StudioGlyph name="inbox" /></span><div><h2>Respond when</h2></div></div>
        <div className="toggle-row"><span>Tagged by name</span><Switch checked={toggles.tagged} onChange={() => onToggle("tagged")} label="Respond when tagged" /></div>
        <div className="toggle-row"><span>Replied to</span><Switch checked={toggles.replied} onChange={() => onToggle("replied")} label="Respond to replies" /></div>
        <div className="toggle-row"><span>Conversation is relevant</span><Switch checked={toggles.relevant} onChange={() => onToggle("relevant")} label="Respond to relevant conversations" /></div>
      </section>

      <section className="dark-settings-card single-toggle">
        <span className="module-icon gray"><StudioGlyph name="bot" /></span>
        <p><strong>See other bots</strong><small>Ignore automated messages by default</small></p>
        <Switch checked={toggles.otherBots} onChange={() => onToggle("otherBots")} label="See other bots" />
      </section>

      <button className="administrators-row" onClick={() => onNotice("Administrator access opened · demo mode")}>
        <span className="module-icon purple"><StudioGlyph name="users" /></span>
        <p><strong>{agent === "guardian" ? "Community administrators" : "Account administrators"}</strong><small>2 trusted humans</small></p>
        <StudioGlyph name="arrow" size={18} />
      </button>
      <div className="privacy-callout"><StudioGlyph name="shield" size={18} /><p><strong>Permission changes are reversible.</strong><span>FairTurn asks again whenever access expands.</span></p></div>
    </div>
  );
}

function AutomationSetup({
  onEnableSecretaryMode,
  onCustomize,
}: {
  onEnableSecretaryMode: () => void;
  onCustomize: () => void;
}) {
  return (
    <div className="automation-screen inbox-automation-screen">
      <div className="inbox-automation-heading">
        <h2>Inbox automation</h2>
        <p>
          Set up this bot as your Telegram secretary in five steps: it reads and
          replies to your chats for you.
        </p>
      </div>
      <div className="setup-steps inbox-setup-steps">
        {setupSteps.map((step, index) => {
          const stepNumber = index + 1;
          const linkedAction =
            stepNumber === 1
              ? onEnableSecretaryMode
              : stepNumber === 5
                ? onCustomize
                : null;
          return (
            <article key={step.title}>
              <span className="step-number" aria-hidden="true">{stepNumber}</span>
              <div className="step-line" />
              <div className="step-copy inbox-step-copy">
                {linkedAction ? (
                  <button type="button" className="inbox-step-link" onClick={linkedAction}>
                    <h3>{step.title}</h3>
                    <StudioGlyph name="arrow" size={18} />
                  </button>
                ) : (
                  <div>
                    <h3>{step.title}</h3>
                    {step.trailing === "arrow" ? <StudioGlyph name="arrow" size={18} /> : null}
                    {step.trailing === "copy" ? <StudioGlyph name="copy" size={18} /> : null}
                  </div>
                )}
                <p>{step.description}</p>
                {step.image ? (
                  <div className={`inbox-step-image ${step.imageClassName ?? ""}`}>
                    <img src={step.image} alt={step.imageAlt ?? ""} />
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

const weekdays = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "0", label: "Sunday" },
] as const;

function taskIcon(kind: TaskKind) {
  return {
    post: "send",
    event: "calendar",
    giveaway: "gift",
    quiz: "quiz",
  }[kind];
}

function buildCron(
  schedule: ScheduleKind,
  time: string,
  weekday: string,
  date: string,
) {
  const [hour = "9", minute = "0"] = time.split(":");
  if (schedule === "daily") return `${Number(minute)} ${Number(hour)} * * *`;
  if (schedule === "weekly") {
    return `${Number(minute)} ${Number(hour)} * * ${weekday}`;
  }
  const parsedDate = date.split("-");
  const month = Number(parsedDate[1] ?? 1);
  const day = Number(parsedDate[2] ?? 1);
  return `${Number(minute)} ${Number(hour)} ${day} ${month} *`;
}

function describeSchedule(
  schedule: ScheduleKind,
  time: string,
  weekday: string,
  date: string,
  timezone: string,
) {
  if (schedule === "daily") return `Every day · ${time} ${timezone}`;
  if (schedule === "weekly") {
    const day = weekdays.find((item) => item.value === weekday)?.label ?? "Friday";
    return `Every ${day} · ${time} ${timezone}`;
  }
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return `Choose a date · ${time} ${timezone}`;
  }
  const formattedDate = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
  return `${formattedDate} · ${time} ${timezone}`;
}

function describePersistedSchedule(input: {
  schedule: ScheduleKind;
  cron: string;
  timezone: string;
  nextRunAt: string | null;
}) {
  const [minute = "0", hour = "9", , , weekday = "1"] = input.cron.split(/\s+/u);
  const time = `${String(Number(hour)).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
  if (input.schedule === "once") {
    const parsed = input.nextRunAt ? new Date(input.nextRunAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return "One-time task";
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: input.timezone,
    }).format(parsed);
  }
  return describeSchedule(input.schedule, time, weekday, "", input.timezone);
}

function inferTaskKind(name: string, prompt: string): TaskKind {
  const text = `${name} ${prompt}`.toLowerCase();
  if (/giveaway|airdrop|reward|raffle|winner|prize/u.test(text)) return "giveaway";
  if (/quiz|poll|trivia|questionnaire/u.test(text)) return "quiz";
  if (/event|ama|space|webinar|meetup|workshop|conference/u.test(text)) return "event";
  return "post";
}

function timeOptionLabel(value: string) {
  const [hour = "0", minute = "00"] = value.split(":");
  const numericHour = Number(hour);
  const suffix = numericHour >= 12 ? "PM" : "AM";
  const displayHour = numericHour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

const taskTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  const minute = index % 2 === 0 ? "00" : "30";
  return `${String(hour).padStart(2, "0")}:${minute}`;
});

function CreatorAutomations({
  tasks,
  state,
  busy,
  onToggle,
  onCreate,
}: {
  tasks: CreatorTask[];
  state: TaskDataState;
  busy: boolean;
  onToggle: (id: string) => void;
  onCreate: () => void;
}) {
  const emptyLabel =
    state === "checking"
      ? "Loading scheduled tasks…"
      : state === "outside"
        ? "Open FairTurn in Telegram to view tasks."
        : state === "error"
          ? "Tasks are unavailable right now."
          : "No scheduled tasks yet";

  return (
    <div className="creator-automation-screen simple-task-screen">
      <h2 className="simple-task-title">Tasks</h2>
      <p className="simple-task-subtitle">Scheduled &amp; recurring tasks, triggers</p>

      {tasks.length === 0 ? (
        <div className="simple-task-empty" aria-live="polite">{emptyLabel}</div>
      ) : (
        <div className="scheduled-task-list simple-scheduled-task-list">
          {tasks.map((task) => (
            <article className={!task.enabled ? "paused" : ""} key={task.id}>
              <span className={`scheduled-task-icon ${task.kind}`}>
                <StudioGlyph name={taskIcon(task.kind)} size={19} />
              </span>
              <div className="scheduled-task-copy">
                <div>
                  <strong>{task.name}</strong>
                  <Switch
                    checked={task.enabled}
                    onChange={() => onToggle(task.id)}
                    label={`${task.enabled ? "Pause" : "Enable"} ${task.name}`}
                  />
                </div>
                <p>{task.prompt}</p>
                <div className="scheduled-task-meta">
                  <span><StudioGlyph name="users" size={13} />{task.target}</span>
                  <span><StudioGlyph name="clock" size={13} />{task.scheduleLabel}</span>
                </div>
                <div className="scheduled-task-badges">
                  <b>{task.kind}</b>
                  <b className={task.requiresApproval ? "review" : "automatic"}>
                    {task.requiresApproval ? "Human review" : "Automatic"}
                  </b>
                  {!task.enabled ? <b>Paused</b> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="simple-task-help">
        Ask FairTurn to run something on a schedule, or create one manually.
      </p>
      <button className="new-creator-task simple-task-action" disabled={busy} onClick={onCreate}>
        {busy ? "Please wait…" : "New Task"}
      </button>
    </div>
  );
}

function NewTaskComposer({
  targets,
  state,
  busy,
  onSave,
}: {
  targets: TaskTargetGroup[];
  state: TaskDataState;
  busy: boolean;
  onSave: (task: CreatorTaskInput) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targetId, setTargetId] = useState(() => targets[0]?.id ?? "");
  const [schedule, setSchedule] = useState<"daily" | "weekly">("daily");
  const [weekday, setWeekday] = useState("1");
  const [time, setTime] = useState("09:00");
  const [timezone] = useState(() => readPreferredTimeZone());
  const selectedTargetId = targetId || targets[0]?.id || "";
  const target = targets.find((item) => item.id === selectedTargetId) ?? null;
  const kind = inferTaskKind(name, prompt);
  const forcedReview = kind === "event" || kind === "giveaway";
  const cron = buildCron(schedule, time, weekday, "");
  const scheduleLabel = describeSchedule(
    schedule,
    time,
    weekday,
    "",
    timezone,
  );
  const isValid =
    name.trim().length >= 3 && prompt.trim().length >= 12 && Boolean(target);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || !target || busy) return;
    await onSave({
      kind,
      name: name.trim(),
      prompt: prompt.trim(),
      target: target.name,
      schedule,
      scheduleLabel,
      cron,
      timezone,
      requiresApproval: forcedReview,
      targetChatId: target.chatId,
      managedBotId: target.managedBotId,
    });
  }

  return (
    <div className="new-task-screen simple-new-task-screen">
      <h2 className="simple-task-title">New Task</h2>

      <form className="new-task-form simple-new-task-form" onSubmit={(event) => void submitTask(event)}>
        <p className="simple-task-label">Task details</p>
        <section className="simple-task-details-card">
          <input
            id="task-name"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Short name for this task"
            required
            value={name}
            aria-label="Short name for this task"
          />
          <textarea
            id="task-prompt"
            maxLength={1_500}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What should run on each run?"
            required
            value={prompt}
            aria-label="What should run on each run?"
          />
        </section>

        <label className="simple-task-label" htmlFor="task-target">Target group</label>
        <div className="simple-task-select-card">
          <select
            id="task-target"
            value={selectedTargetId}
            onChange={(event) => setTargetId(event.target.value)}
            disabled={targets.length === 0}
          >
            <option value="">{state === "checking" ? "Loading groups…" : "Select group…"}</option>
            {targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>

        <p className="simple-task-label">Schedule ({timezone} time)</p>
        <section className="simple-task-schedule-card">
          <select
            id="task-schedule"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value as "daily" | "weekly")}
            aria-label="Task schedule"
          >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
          </select>
          {schedule === "weekly" && (
            <select
              id="task-weekday"
              value={weekday}
              onChange={(event) => setWeekday(event.target.value)}
              aria-label="Day of week"
            >
              {weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
            </select>
          )}
          <select
            id="task-time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            aria-label="Task time"
          >
            {taskTimeOptions.map((value) => (
              <option key={value} value={value}>{timeOptionLabel(value)}</option>
            ))}
          </select>
        </section>

        <div className="simple-task-cron">
          <span>Raw Cron:</span>
          <code>{cron}</code>
        </div>
        {state === "ready" && targets.length === 0 ? (
          <p className="focused-service-note task-target-note">
            Add your FairTurn agent to a Telegram group before creating a task.
          </p>
        ) : state === "outside" ? (
          <p className="focused-service-note task-target-note">
            Open FairTurn inside Telegram to create scheduled tasks.
          </p>
        ) : null}
        {forcedReview ? (
          <p className="focused-service-note task-target-note">
            FairTurn recognized a sensitive {kind} task; winner, reward, or public commitment steps will require your approval.
          </p>
        ) : null}
        <button className="focused-primary-button simple-save-task" type="submit" disabled={!isValid || busy}>
          {busy ? "Saving…" : "Save Task"}
        </button>
      </form>
    </div>
  );
}

type KnowledgeContextAgent = {
  id: string;
  name: string;
  username: string;
  status: string;
};

type KnowledgeContextCommunity = {
  id: string;
  name: string;
  chatId: string;
  managedBotId: string;
};

type KnowledgeItem = {
  id: string;
  kind: string;
  title: string;
  sourceType: string;
  sourceUrl?: string | null;
  sourceFileName?: string | null;
  sourceBytes?: number | null;
  learningMode: string;
  updatedAt: string;
};

function KnowledgeModule({
  onNotice,
  preferredAgentId,
}: {
  onNotice: (message: string) => void;
  preferredAgentId: string | null;
}) {
  const [agents, setAgents] = useState<KnowledgeContextAgent[]>([]);
  const [communities, setCommunities] = useState<KnowledgeContextCommunity[]>([]);
  const [managedBotId, setManagedBotId] = useState("");
  const [chatId, setChatId] = useState("");
  const [kind, setKind] = useState("docs");
  const [title, setTitle] = useState("");
  const [sourceMode, setSourceMode] = useState<"file" | "website" | "note">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [status, setStatus] = useState<
    "loading" | "ready" | "outside" | "empty" | "error"
  >("loading");
  const [busy, setBusy] = useState(false);

  const groupsForAgent = communities.filter(
    (community) => community.managedBotId === managedBotId,
  );

  const loadItems = useCallback(async (agentId: string, targetChatId: string) => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData || !agentId || !targetChatId) {
      setItems([]);
      return;
    }
    const response = await fetch(
      `/api/sparks/${encodeURIComponent(agentId)}/knowledge?chatId=${encodeURIComponent(targetChatId)}`,
      {
        headers: { "x-telegram-init-data": initData },
        cache: "no-store",
      },
    );
    const payload = (await response.json()) as {
      error?: string;
      items?: KnowledgeItem[];
    };
    if (!response.ok) throw new Error(payload.error ?? "Knowledge is unavailable");
    setItems(payload.items ?? []);
  }, []);

  useEffect(() => {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData) {
      const markOutside = window.setTimeout(() => setStatus("outside"), 0);
      return () => window.clearTimeout(markOutside);
    }
    let cancelled = false;
    const selectedAgentQuery = preferredAgentId
      ? `?agentId=${encodeURIComponent(preferredAgentId)}`
      : "";
    void fetch(`/api/community/knowledge-context${selectedAgentQuery}`, {
      headers: { "x-telegram-init-data": initData },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          error?: string;
          agents?: KnowledgeContextAgent[];
          communities?: KnowledgeContextCommunity[];
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Knowledge setup is unavailable");
        }
        if (cancelled) return;
        const nextAgents = payload.agents ?? [];
        const nextCommunities = payload.communities ?? [];
        setAgents(nextAgents);
        setCommunities(nextCommunities);
        const firstAgent =
          nextAgents.find((agent) => agent.id === preferredAgentId)?.id ??
          nextAgents[0]?.id ??
          "";
        const firstChat = nextCommunities.find(
          (community) => community.managedBotId === firstAgent,
        )?.chatId ?? "";
        setManagedBotId(firstAgent);
        setChatId(firstChat);
        setStatus(firstAgent && firstChat ? "ready" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [preferredAgentId]);

  useEffect(() => {
    if (!managedBotId || !chatId) return;
    const refresh = window.setTimeout(() => {
      void loadItems(managedBotId, chatId).catch(() => setStatus("error"));
    }, 0);
    return () => window.clearTimeout(refresh);
  }, [chatId, loadItems, managedBotId]);

  function chooseAgent(nextAgentId: string) {
    setManagedBotId(nextAgentId);
    setChatId(
      communities.find((community) => community.managedBotId === nextAgentId)
        ?.chatId ?? "",
    );
  }

  async function addKnowledge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData || !managedBotId || !chatId) {
      onNotice("Open FairTurn in Telegram and connect a group first");
      return;
    }
    const fallbackTitle =
      file?.name.replace(/\.[^.]+$/u, "") ||
      (() => {
        try {
          return url ? new URL(url).hostname : "";
        } catch {
          return "";
        }
      })();
    const resolvedTitle = title.trim() || fallbackTitle;
    if (!resolvedTitle) {
      onNotice("Give this knowledge source a short title");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("chatId", chatId);
      form.set("kind", kind);
      form.set("title", resolvedTitle);
      if (sourceMode === "file" && file) form.set("file", file);
      if (sourceMode === "website") form.set("url", url.trim());
      if (sourceMode === "note") form.set("content", content.trim());
      const response = await fetch(
        `/api/sparks/${encodeURIComponent(managedBotId)}/knowledge`,
        {
          method: "POST",
          headers: { "x-telegram-init-data": initData },
          body: form,
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        duplicate?: boolean;
      };
      if (!response.ok) throw new Error(payload.error ?? "Knowledge upload failed");
      await loadItems(managedBotId, chatId);
      setTitle("");
      setFile(null);
      setUrl("");
      setContent("");
      onNotice(
        payload.duplicate
          ? "FairTurn already knows that source"
          : "Knowledge saved · FairTurn can answer from it now",
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Knowledge upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: KnowledgeItem) {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    if (!initData || !managedBotId || !chatId) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/sparks/${encodeURIComponent(managedBotId)}/knowledge`,
        {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            "x-telegram-init-data": initData,
          },
          body: JSON.stringify({ chatId, knowledgeId: item.id }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Delete failed");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      onNotice(`Forgot ${item.title} · stored source deleted`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "outside") {
    return (
      <div className="module-screen knowledge-module-screen">
        <div className="automation-heading"><span className="module-icon green"><StudioGlyph name="book" /></span><div><span>Community brain</span><h2>Knowledge</h2><p>Open this Mini App inside Telegram to manage your FairTurn sources.</p></div></div>
        <section className="knowledge-empty-card"><StudioGlyph name="telegram" size={26} /><strong>Telegram verification required</strong><span>You can still teach FairTurn directly in a group: send a supported document or simply tell it what to remember.</span></section>
      </div>
    );
  }

  return (
    <div className="module-screen knowledge-module-screen">
      <div className="automation-heading"><span className="module-icon green"><StudioGlyph name="book" /></span><div><span>Community brain</span><h2>Knowledge</h2><p>Upload project sources once. FairTurn retrieves them when members ask questions.</p></div></div>

      <section className="knowledge-telegram-card">
        <span className="module-icon green"><StudioGlyph name="telegram" /></span>
        <p><strong>Teach FairTurn without opening this screen</strong><small>In the target group, an admin can send a document or website, reply to a message and say <b>FairTurn, remember this as our FAQ</b>, or ask <b>What do you remember?</b></small></p>
      </section>

      {status === "empty" ? (
        <section className="knowledge-empty-card"><StudioGlyph name="shield" size={26} /><strong>Connect FairTurn to a group first</strong><span>Once FairTurn sees the group, it will appear here automatically.</span></section>
      ) : status === "error" ? (
        <section className="knowledge-empty-card"><StudioGlyph name="shield" size={26} /><strong>Knowledge needs attention</strong><span>Reopen FairTurn from Telegram and check the agent connection.</span></section>
      ) : (
        <>
          <form className="knowledge-composer" onSubmit={addKnowledge}>
            <div className="knowledge-target-grid">
              <label>FairTurn agent<select value={managedBotId} onChange={(event) => chooseAgent(event.target.value)}>{agents.map((item) => <option key={item.id} value={item.id}>{item.name} · @{item.username}</option>)}</select></label>
              <label>Community<select value={chatId} onChange={(event) => setChatId(event.target.value)}>{groupsForAgent.map((item) => <option key={item.id} value={item.chatId}>{item.name}</option>)}</select></label>
              <label>Type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="docs">Documentation</option><option value="faq">FAQ</option><option value="rules">Rules</option><option value="links">Official links</option><option value="roles">Roles</option><option value="moderation_policy">Moderation policy</option></select></label>
            </div>
            <div className="knowledge-source-tabs" role="tablist" aria-label="Knowledge source"><button className={sourceMode === "file" ? "active" : ""} type="button" onClick={() => setSourceMode("file")}>File</button><button className={sourceMode === "website" ? "active" : ""} type="button" onClick={() => setSourceMode("website")}>Website</button><button className={sourceMode === "note" ? "active" : ""} type="button" onClick={() => setSourceMode("note")}>Note</button></div>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Project whitepaper" /></label>
            {sourceMode === "file" ? <label className="knowledge-file-drop">PDF, DOCX, TXT, Markdown, HTML, or JSON · max 8 MB<input type="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html,application/json" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /><span>{file?.name ?? "Choose a source file"}</span></label> : null}
            {sourceMode === "website" ? <label>Public HTTPS page<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://project.xyz/whitepaper" required /></label> : null}
            {sourceMode === "note" ? <label>Knowledge note<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} maxLength={120000} placeholder="Paste an approved fact, FAQ, rule, or project explanation…" required /></label> : null}
            <button className="knowledge-save-button" disabled={busy || !chatId || (sourceMode === "file" && !file)}>{busy ? "Teaching FairTurn…" : "Add to FairTurn knowledge"}</button>
          </form>

          <section className="knowledge-library">
            <div><span>Saved sources</span><b>{items.length}</b></div>
            {items.length ? items.map((item) => (
              <article key={item.id}><span className="module-icon green"><StudioGlyph name={item.sourceFileName ? "book" : "link"} size={18} /></span><p><strong>{item.title}</strong><small>{item.kind.replaceAll("_", " ")} · {item.sourceFileName ?? item.sourceUrl ?? (item.learningMode.startsWith("telegram") ? "learned in Telegram" : "saved note")}</small></p><button disabled={busy} onClick={() => void removeItem(item)} aria-label={`Delete ${item.title}`}>Forget</button></article>
            )) : <p className="knowledge-library-empty">No saved sources yet. Upload one here or teach FairTurn directly in Telegram.</p>}
          </section>
        </>
      )}
    </div>
  );
}

function InstructionsModule({
  persona,
  rules,
  welcomeMessage,
  onPersona,
  onRules,
  onWelcomeMessage,
  onSave,
  state,
  busy,
}: {
  persona: string;
  rules: string;
  welcomeMessage: string;
  onPersona: (value: string) => void;
  onRules: (value: string) => void;
  onWelcomeMessage: (value: string) => void;
  onSave: () => void;
  state: AgentConfigurationState;
  busy: boolean;
}) {
  return (
    <form
      className="focused-module-screen instructions-module"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2 className="focused-module-title">Instructions</h2>

      <label className="focused-field-label" htmlFor="agent-persona">
        Persona
      </label>
      <textarea
        id="agent-persona"
        className="focused-textarea persona-textarea"
        value={persona}
        onChange={(event) => onPersona(event.target.value)}
        placeholder="e.g. You are a friendly support assistant for an online store…"
        maxLength={1_500}
      />
      <p className="focused-help">
        Who the agent is: its name, role, tone, and personality.
      </p>

      <label className="focused-field-label rules-label" htmlFor="agent-rules">
        Rules
      </label>
      <textarea
        id="agent-rules"
        className="focused-textarea rules-textarea"
        value={rules}
        onChange={(event) => onRules(event.target.value)}
        placeholder="e.g. Always reply in the user's language. Never share internal pricing…"
        maxLength={2_500}
      />
      <p className="focused-help">
        Mandatory rules the agent must always follow. These take priority over
        memory, summaries and user requests.
      </p>

      <label className="focused-field-label welcome-label" htmlFor="agent-welcome-message">
        Welcome Message
      </label>
      <textarea
        id="agent-welcome-message"
        className="focused-textarea welcome-textarea"
        value={welcomeMessage}
        onChange={(event) => onWelcomeMessage(event.target.value)}
        placeholder="Hi! I'm your assistant. How can I help?"
        maxLength={1_000}
      />
      <p className="focused-help">
        Sent when someone opens your bot with /start. Leave empty to use the default.
      </p>

      {state === "outside" ? (
        <p className="focused-service-note">Open FairTurn inside Telegram to save.</p>
      ) : state === "error" ? (
        <p className="focused-service-note error">Saved settings could not be loaded. You can retry Save.</p>
      ) : null}

      <button
        className="focused-primary-button instructions-save-button"
        type="submit"
        disabled={busy || state === "checking" || state === "outside"}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function memoryDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved memory";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function MemoryModule({
  memories,
  state,
  busy,
  canWrite,
  onAdd,
  onDelete,
}: {
  memories: AgentMemoryItem[];
  state: AgentConfigurationState;
  busy: boolean;
  canWrite: boolean;
  onAdd: (summary: string) => Promise<boolean>;
  onDelete: (memoryId: string) => void;
}) {
  const [note, setNote] = useState("");

  async function addNote() {
    const summary = note.trim();
    if (!summary || busy || !canWrite) return;
    if (await onAdd(summary)) setNote("");
  }

  const memoryStatus =
    state === "checking"
      ? "Loading memories…"
      : state === "outside"
        ? "Open FairTurn in Telegram to view memories."
        : state === "error"
          ? "Memories are unavailable right now."
          : "No memories yet.";

  return (
    <div className="focused-module-screen memory-module">
      <h2 className="focused-module-title">Memory</h2>

      <p className="focused-field-label">Memory</p>
      <section className="memory-list" aria-live="polite">
        {memories.length === 0 ? (
          <p className="memory-empty">{memoryStatus}</p>
        ) : (
          memories.map((memory) => (
            <article className="memory-item" key={memory.id}>
              <div>
                <p>{memory.summary}</p>
                <small>{memoryDateLabel(memory.createdAt)}</small>
              </div>
              <button
                type="button"
                className="memory-delete"
                onClick={() => onDelete(memory.id)}
                disabled={busy}
                aria-label={`Delete memory: ${memory.summary}`}
              >
                Delete
              </button>
            </article>
          ))
        )}
      </section>
      <p className="focused-help">
        What your agent remembers across chats. It writes privacy-safe memories
        itself; review or delete them here.
      </p>

      <section className="memory-note-card">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note for your agent to remember…"
          maxLength={600}
          aria-label="Memory note"
        />
        <button
          type="button"
          className="focused-primary-button memory-add-button"
          onClick={() => void addNote()}
          disabled={!note.trim() || busy || !canWrite}
        >
          {busy ? "Adding…" : "Add note"}
        </button>
      </section>
      <p className="focused-help">
        Add something you want your agent to remember across chats.
      </p>
      {state === "ready" && !canWrite ? (
        <p className="focused-service-note">
          Connect Supabase Memory to add notes for this agent.
        </p>
      ) : null}
    </div>
  );
}

function ModuleSettings({
  screen,
  persona,
  rules,
  welcomeMessage,
  onPersona,
  onRules,
  onWelcomeMessage,
  onSaveInstructions,
  memories,
  configurationState,
  configurationBusy,
  canWriteMemory,
  onAddMemory,
  onDeleteMemory,
  integrationStatus,
}: {
  screen: Exclude<StudioScreen, "home" | "profile" | "access" | "automation" | "knowledge" | "tasks" | "newTask">;
  persona: string;
  rules: string;
  welcomeMessage: string;
  onPersona: (value: string) => void;
  onRules: (value: string) => void;
  onWelcomeMessage: (value: string) => void;
  onSaveInstructions: () => void;
  memories: AgentMemoryItem[];
  configurationState: AgentConfigurationState;
  configurationBusy: boolean;
  canWriteMemory: boolean;
  onAddMemory: (summary: string) => Promise<boolean>;
  onDeleteMemory: (memoryId: string) => void;
  integrationStatus: {
    telegram: boolean;
    minds: boolean;
    supabaseMemory: boolean;
  };
}) {
  if (screen === "instructions") {
    return (
      <InstructionsModule
        persona={persona}
        rules={rules}
        welcomeMessage={welcomeMessage}
        onPersona={onPersona}
        onRules={onRules}
        onWelcomeMessage={onWelcomeMessage}
        onSave={onSaveInstructions}
        state={configurationState}
        busy={configurationBusy}
      />
    );
  }

  if (screen === "memory") {
    return (
      <MemoryModule
        memories={memories}
        state={configurationState}
        busy={configurationBusy}
        canWrite={canWriteMemory}
        onAdd={onAddMemory}
        onDelete={onDeleteMemory}
      />
    );
  }

  const content = {
    integrations: { icon: "link", tone: "green", eyebrow: "Connected tools", title: "Integrations", description: "Keep community and personal inbox permissions separate." },
    guardrails: { icon: "shield", tone: "green", eyebrow: "Always enforced", title: "Guardrails", description: "Hard limits apply even when an instruction asks FairTurn to ignore them." },
  }[screen];

  return (
    <div className="module-screen">
      <div className="automation-heading"><span className={`module-icon ${content.tone}`}><StudioGlyph name={content.icon} /></span><div><span>{content.eyebrow}</span><h2>{content.title}</h2><p>{content.description}</p></div></div>
      {screen === "integrations" && (
        <section className="integration-list"><div><span className="integration-logo telegram-logo"><StudioGlyph name="bot" /></span><p><strong>Telegram FairTurn</strong><small>Group moderation + selected Business inbox chats</small></p><b>{integrationStatus.telegram ? "Manager on" : "Set up"}</b></div><div><span className="integration-logo minds-logo"><StudioGlyph name="brain" /></span><p><strong>HelloMinds</strong><small>Persistent moderation reasoning · safe fallback</small></p><b>{integrationStatus.minds ? "Live" : "Fallback"}</b></div><div><span className="integration-logo minds-logo"><StudioGlyph name="brain" /></span><p><strong>Supabase Memory</strong><small>Redacted preferences and decision outcomes</small></p><b>{integrationStatus.supabaseMemory ? "Live" : "Set up"}</b></div></section>
      )}
      {screen === "guardrails" && (
        <section className="guardrail-list"><div><StudioGlyph name="shield" /><p><strong>Owner-scoped personal inbox</strong><small>Only the verified owner’s selected Telegram Business chats are accepted.</small></p></div><div><StudioGlyph name="shield" /><p><strong>No autonomous high-risk action</strong><small>Bans, mutes, money, legal, and public statements need a human.</small></p></div><div><StudioGlyph name="shield" /><p><strong>No fake end-to-end encryption claim</strong><small>Telegram’s platform security model still applies.</small></p></div><div><StudioGlyph name="shield" /><p><strong>Every rule can be revoked</strong><small>Access and memory settings have clear off switches.</small></p></div></section>
      )}
    </div>
  );
}
