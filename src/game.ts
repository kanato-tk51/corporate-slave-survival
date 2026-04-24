export type Stats = {
  stamina: number;
  trust: number;
  focus: number;
  fire: number;
  backlog: number;
};

export type TaskType = "meeting" | "slack" | "emergency" | "document" | "break";

export type PersonId = "ceo" | "manager" | "senior" | "peer" | "junior" | "self";

export type AvatarId = "pressure" | "meeting" | "craft" | "slack" | "rookie" | "reason";

export type PersonImageSource = "demo" | "custom" | "none";

export type StatDelta = Partial<Stats>;

export type TaskDefinition = {
  label: string;
  text: string;
  icon: string;
  color: string;
  accent: string;
  weight: number;
  clickEffect: StatDelta;
  missEffect: StatDelta;
  durationMs: number;
  work: boolean;
};

export type AvatarDefinition = {
  label: string;
  glyph: string;
  tone: string;
};

export type PersonDefinition = {
  role: string;
  defaultName: string;
  avatarId: AvatarId;
  color: string;
  weight: number;
  allowedTaskTypes: TaskType[];
  clickModifier: StatDelta;
  missModifier: StatDelta;
};

export type PersonSetting = {
  id: PersonId;
  role: string;
  name: string;
  avatarId: AvatarId;
  imageSource?: PersonImageSource;
  imageDataUrl?: string;
};

export type PersonSettings = Record<PersonId, PersonSetting>;

export type ActiveTask = {
  id: number;
  type: TaskType;
  personId: PersonId;
  lane: number;
  spawnedAt: number;
  durationMs: number;
};

export type GamePhase = "ready" | "playing" | "ended";

export type EndReason = "survived" | "stamina" | "fire";

export type Result = {
  reason: EndReason;
  title: string;
  score: number;
  stats: Stats;
  handledCount: number;
  missedCount: number;
};

export type BestRecord = {
  title: string;
  score: number;
  trust: number;
  handledCount: number;
  createdAt: string;
};

export const GAME_DURATION_MS = 60_000;
export const LANE_COUNT = 5;
export const BEST_RECORD_KEY = "shachiku-survival-best";
export const PERSON_SETTINGS_KEY = "shachiku-survival-people";

export const PERSON_ORDER: PersonId[] = ["ceo", "manager", "senior", "peer", "junior", "self"];
export const AVATAR_ORDER: AvatarId[] = ["pressure", "meeting", "craft", "slack", "rookie", "reason"];

export const INITIAL_STATS: Stats = {
  stamina: 75,
  trust: 45,
  focus: 70,
  fire: 15,
  backlog: 20,
};

export const TASK_DEFINITIONS: Record<TaskType, TaskDefinition> = {
  meeting: {
    label: "会議",
    text: "5分だけ会議",
    icon: "👥",
    color: "#7c4dff",
    accent: "#d7c8ff",
    weight: 22,
    clickEffect: { stamina: -8, focus: -10, trust: 7, fire: -3, backlog: -1 },
    missEffect: { trust: -8, fire: 10, backlog: 2 },
    durationMs: 7200,
    work: true,
  },
  slack: {
    label: "Slack返信",
    text: "今できます？",
    icon: "🔔",
    color: "#00a3a3",
    accent: "#a7f3f0",
    weight: 27,
    clickEffect: { focus: -6, trust: 5, fire: -2, backlog: -1 },
    missEffect: { trust: -5, fire: 8, backlog: 1 },
    durationMs: 6200,
    work: true,
  },
  emergency: {
    label: "緊急対応",
    text: "至急: 本番障害",
    icon: "⚠",
    color: "#db2b39",
    accent: "#ffc0c5",
    weight: 13,
    clickEffect: { stamina: -14, focus: -8, trust: 12, fire: -18, backlog: -2 },
    missEffect: { trust: -15, fire: 25, backlog: 3 },
    durationMs: 5600,
    work: true,
  },
  document: {
    label: "資料作成",
    text: "明朝まで資料",
    icon: "📄",
    color: "#d97706",
    accent: "#fed7aa",
    weight: 24,
    clickEffect: { stamina: -5, focus: -14, trust: 9, fire: -4, backlog: -1 },
    missEffect: { trust: -7, fire: 12, backlog: 2 },
    durationMs: 6900,
    work: true,
  },
  break: {
    label: "休憩",
    text: "給湯室へ避難",
    icon: "☕",
    color: "#2f9e44",
    accent: "#b7efc5",
    weight: 14,
    clickEffect: { stamina: 16, focus: 12, trust: -2, fire: 3 },
    missEffect: {},
    durationMs: 5200,
    work: false,
  },
};

export const AVATAR_PRESETS: Record<AvatarId, AvatarDefinition> = {
  pressure: { label: "威圧", glyph: "社", tone: "pressure" },
  meeting: { label: "会議", glyph: "会", tone: "meeting" },
  craft: { label: "職人", glyph: "匠", tone: "craft" },
  slack: { label: "通知", glyph: "通", tone: "slack" },
  rookie: { label: "新卒", glyph: "新", tone: "rookie" },
  reason: { label: "理性", glyph: "理", tone: "reason" },
};

function createPersonImageDataUrl({
  bg,
  jacket,
  accent,
  hair,
  label,
}: {
  bg: string;
  jacket: string;
  accent: string;
  hair: string;
  label: string;
}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="${bg}"/>
        <stop offset="1" stop-color="#171311"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="5" flood-color="#000000" flood-opacity=".28"/>
      </filter>
    </defs>
    <rect width="160" height="160" rx="34" fill="url(#bg)"/>
    <circle cx="124" cy="30" r="20" fill="${accent}" opacity=".8"/>
    <circle cx="32" cy="124" r="28" fill="#ffffff" opacity=".12"/>
    <g filter="url(#shadow)">
      <path d="M32 146c7-34 25-52 48-52s41 18 48 52H32z" fill="${jacket}"/>
      <path d="M63 98h34l-8 30H71l-8-30z" fill="#f7d8b6"/>
      <circle cx="80" cy="70" r="31" fill="#f5c99d"/>
      <path d="M48 65c2-28 20-43 47-35 14 4 22 15 19 34-17-6-37-12-66 1z" fill="${hair}"/>
      <circle cx="69" cy="73" r="4" fill="#171311"/>
      <circle cx="92" cy="73" r="4" fill="#171311"/>
      <path d="M70 88c7 7 15 7 22 0" fill="none" stroke="#7c2d12" stroke-width="4" stroke-linecap="round"/>
      <path d="M69 104l11 13 11-13 11 39H58l11-39z" fill="#f7f4ee"/>
      <circle cx="80" cy="118" r="20" fill="${accent}"/>
      <text x="80" y="127" text-anchor="middle" font-size="28" font-weight="900" font-family="system-ui, sans-serif" fill="#171311">${label}</text>
    </g>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const DEFAULT_PERSON_IMAGES: Record<PersonId, string> = {
  ceo: createPersonImageDataUrl({
    bg: "#f43f5e",
    jacket: "#111827",
    accent: "#ffd166",
    hair: "#2b1712",
    label: "社",
  }),
  manager: createPersonImageDataUrl({
    bg: "#a855f7",
    jacket: "#312e81",
    accent: "#d7c8ff",
    hair: "#3b241c",
    label: "部",
  }),
  senior: createPersonImageDataUrl({
    bg: "#f59e0b",
    jacket: "#78350f",
    accent: "#fed7aa",
    hair: "#5f2e13",
    label: "先",
  }),
  peer: createPersonImageDataUrl({
    bg: "#06b6d4",
    jacket: "#164e63",
    accent: "#a7f3f0",
    hair: "#2f241e",
    label: "同",
  }),
  junior: createPersonImageDataUrl({
    bg: "#22c55e",
    jacket: "#14532d",
    accent: "#b7efc5",
    hair: "#4a2c1b",
    label: "後",
  }),
  self: createPersonImageDataUrl({
    bg: "#2f9e44",
    jacket: "#1f2937",
    accent: "#c7f9cc",
    hair: "#2d221b",
    label: "自",
  }),
};

export const PERSON_DEFINITIONS: Record<PersonId, PersonDefinition> = {
  ceo: {
    role: "社長",
    defaultName: "黒川",
    avatarId: "pressure",
    color: "#f43f5e",
    weight: 6,
    allowedTaskTypes: ["meeting", "slack", "emergency", "document"],
    clickModifier: { stamina: -3, trust: 8, focus: -4, fire: -4 },
    missModifier: { trust: -20, fire: 45, backlog: 2 },
  },
  manager: {
    role: "部長",
    defaultName: "田中",
    avatarId: "meeting",
    color: "#a855f7",
    weight: 18,
    allowedTaskTypes: ["meeting", "slack", "emergency", "document"],
    clickModifier: { stamina: -2, trust: 4, focus: -5 },
    missModifier: { trust: -10, fire: 16, backlog: 1 },
  },
  senior: {
    role: "先輩",
    defaultName: "佐藤",
    avatarId: "craft",
    color: "#f59e0b",
    weight: 20,
    allowedTaskTypes: ["slack", "emergency", "document"],
    clickModifier: { trust: 3, focus: -2 },
    missModifier: { trust: -6, fire: 8 },
  },
  peer: {
    role: "同僚",
    defaultName: "鈴木",
    avatarId: "slack",
    color: "#06b6d4",
    weight: 30,
    allowedTaskTypes: ["meeting", "slack", "document"],
    clickModifier: { trust: 1, focus: -1 },
    missModifier: { trust: -4, fire: 4 },
  },
  junior: {
    role: "後輩",
    defaultName: "山田",
    avatarId: "rookie",
    color: "#22c55e",
    weight: 20,
    allowedTaskTypes: ["slack", "emergency", "document"],
    clickModifier: { stamina: -4, trust: 5, focus: -3, backlog: 1 },
    missModifier: { trust: -8, fire: 8, backlog: 1 },
  },
  self: {
    role: "自分",
    defaultName: "自分の理性",
    avatarId: "reason",
    color: "#2f9e44",
    weight: 0,
    allowedTaskTypes: ["break"],
    clickModifier: { fire: -1 },
    missModifier: {},
  },
};

export function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function clampStats(stats: Stats): Stats {
  return {
    stamina: clamp(stats.stamina),
    trust: clamp(stats.trust),
    focus: clamp(stats.focus),
    fire: clamp(stats.fire),
    backlog: clamp(stats.backlog, 0, 50),
  };
}

export function applyEffect(stats: Stats, effect: StatDelta): Stats {
  return clampStats({
    stamina: stats.stamina + (effect.stamina ?? 0),
    trust: stats.trust + (effect.trust ?? 0),
    focus: stats.focus + (effect.focus ?? 0),
    fire: stats.fire + (effect.fire ?? 0),
    backlog: stats.backlog + (effect.backlog ?? 0),
  });
}

export function mergeEffects(...effects: StatDelta[]): StatDelta {
  return effects.reduce<StatDelta>((merged, effect) => {
    for (const key of Object.keys(effect) as Array<keyof Stats>) {
      merged[key] = (merged[key] ?? 0) + (effect[key] ?? 0);
    }

    return merged;
  }, {});
}

export function getResolvedEffect(taskType: TaskType, personId: PersonId, mode: "click" | "miss") {
  const task = TASK_DEFINITIONS[taskType];
  const person = PERSON_DEFINITIONS[personId];

  return mergeEffects(
    mode === "click" ? task.clickEffect : task.missEffect,
    mode === "click" ? person.clickModifier : person.missModifier,
  );
}

export function pickTaskType(): TaskType {
  const entries = Object.entries(TASK_DEFINITIONS) as Array<[TaskType, TaskDefinition]>;
  const totalWeight = entries.reduce((sum, [, task]) => sum + task.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const [type, task] of entries) {
    roll -= task.weight;
    if (roll <= 0) {
      return type;
    }
  }

  return "slack";
}

export function pickPersonForTask(taskType: TaskType): PersonId {
  if (taskType === "break") {
    return "self";
  }

  const entries = PERSON_ORDER.filter((personId) => {
    const person = PERSON_DEFINITIONS[personId];
    return person.weight > 0 && person.allowedTaskTypes.includes(taskType);
  }).map((personId) => [personId, PERSON_DEFINITIONS[personId]] as const);

  const totalWeight = entries.reduce((sum, [, person]) => sum + person.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const [personId, person] of entries) {
    roll -= person.weight;
    if (roll <= 0) {
      return personId;
    }
  }

  return "peer";
}

export function getSpawnInterval(elapsedMs: number) {
  const progress = clamp(elapsedMs / GAME_DURATION_MS, 0, 1);
  return Math.round(1200 - 650 * progress);
}

export function calculateScore(stats: Stats, handledCount: number) {
  return Math.round(
    stats.trust * 1.2 +
      stats.stamina * 0.4 +
      stats.focus * 0.3 -
      stats.fire * 1.1 -
      stats.backlog * 0.8 +
      handledCount * 1.5,
  );
}

export function getResultTitle(reason: EndReason, stats: Stats, score: number) {
  if (reason === "stamina") {
    return "燃え尽き退勤";
  }

  if (reason === "fire") {
    return "全社障害級の大炎上";
  }

  if (score >= 120 && stats.fire <= 25 && stats.trust >= 75) {
    return "昇進候補の限界エース";
  }

  if (stats.backlog >= 35) {
    return "会議に飲まれし者";
  }

  if (stats.fire <= 30) {
    return "炎上処理班";
  }

  if (stats.trust >= 65) {
    return "定時を諦めた生存者";
  }

  return "なんとか生存した一般社員";
}

export function createResult(
  reason: EndReason,
  stats: Stats,
  handledCount: number,
  missedCount: number,
): Result {
  const score = calculateScore(stats, handledCount);

  return {
    reason,
    title: getResultTitle(reason, stats, score),
    score,
    stats,
    handledCount,
    missedCount,
  };
}

export function loadBestRecord(): BestRecord | null {
  try {
    const raw = localStorage.getItem(BEST_RECORD_KEY);
    return raw ? (JSON.parse(raw) as BestRecord) : null;
  } catch {
    return null;
  }
}

export function saveBestRecord(record: BestRecord) {
  localStorage.setItem(BEST_RECORD_KEY, JSON.stringify(record));
}

export function getDefaultPersonSettings(): PersonSettings {
  return PERSON_ORDER.reduce<PersonSettings>((settings, id) => {
    const definition = PERSON_DEFINITIONS[id];
    settings[id] = {
      id,
      role: definition.role,
      name: definition.defaultName,
      avatarId: definition.avatarId,
      imageSource: "demo",
      imageDataUrl: DEFAULT_PERSON_IMAGES[id],
    };
    return settings;
  }, {} as PersonSettings);
}

export function loadPersonSettings(): PersonSettings {
  const defaults = getDefaultPersonSettings();

  try {
    const raw = localStorage.getItem(PERSON_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<PersonSettings>) : {};

    return PERSON_ORDER.reduce<PersonSettings>((settings, id) => {
      const previous = parsed[id];
      const defaultSetting = defaults[id];
      const hasValidImage = typeof previous?.imageDataUrl === "string" && previous.imageDataUrl.startsWith("data:image/");
      const imageSource =
        previous?.imageSource === "none"
          ? "none"
          : hasValidImage
            ? previous.imageSource === "demo"
              ? "demo"
              : "custom"
            : "demo";

      settings[id] = {
        id,
        role: typeof previous?.role === "string" && previous.role.trim() ? previous.role : defaultSetting.role,
        name: typeof previous?.name === "string" && previous.name.trim() ? previous.name : defaultSetting.name,
        avatarId:
          previous?.avatarId && AVATAR_ORDER.includes(previous.avatarId) ? previous.avatarId : defaultSetting.avatarId,
        imageSource,
        imageDataUrl: imageSource === "none" ? undefined : hasValidImage ? previous.imageDataUrl : defaultSetting.imageDataUrl,
      };

      return settings;
    }, {} as PersonSettings);
  } catch {
    return defaults;
  }
}

export function savePersonSettings(settings: PersonSettings) {
  localStorage.setItem(PERSON_SETTINGS_KEY, JSON.stringify(settings));
}
