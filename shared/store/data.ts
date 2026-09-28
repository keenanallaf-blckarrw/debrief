import type {
  AccountGuard,
  CashEvent,
  DayJournal,
  Execution,
  ImportRecord,
  NewsEvent,
  OrderEvent,
  Profile,
  Rule,
  Settings,
  TradeNote,
} from "../types";
import { isValidTimezone, localTimezone } from "../util/time";
import type { StoredDebrief, StoredPlaybook } from "../ai/schemas";

/** Everything Debrief saves. Trades, stats and grades are derived from this. */
export interface AppData {
  version: 2;
  onboarded: boolean;
  profile: Profile;
  settings: Settings;
  rules: Rule[];
  guards: AccountGuard[];
  executions: Execution[];
  cash: CashEvent[];
  orders: OrderEvent[];
  imports: ImportRecord[];
  tradeNotes: Record<string, TradeNote>;
  journal: Record<string, DayJournal>;
  debriefs: Record<string, StoredDebrief>;
  playbook?: StoredPlaybook;
  /** Economic calendar events the companion has seen (kept so old sessions keep their news). */
  news: NewsEvent[];
  /** Files already processed from a watched folder (signature → time). */
  seenFiles: Record<string, number>;
}

export const DATA_VERSION = 2 as const;

export function defaultSettings(): Settings {
  return {
    timezone: localTimezone(),
    dayGrouping: "cme",
    commissionPerSide: 0,
    autoDebrief: false,
    prefetchCharts: true,
    plan: "free",
    account: "",
  };
}

export function defaultData(): AppData {
  return {
    version: DATA_VERSION,
    onboarded: false,
    profile: { name: "", markets: [], strategies: [], rulesText: "" },
    settings: defaultSettings(),
    rules: [],
    guards: [],
    executions: [],
    cash: [],
    orders: [],
    imports: [],
    tradeNotes: {},
    journal: {},
    debriefs: {},
    news: [],
    seenFiles: {},
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rec = <T>(v: unknown): Record<string, T> => (isObj(v) ? (v as Record<string, T>) : {});

/** Accept anything that came out of storage or a backup file and return valid data. */
export function normalizeData(raw: unknown): AppData {
  const base = defaultData();
  if (!isObj(raw)) return base;
  const settings = { ...base.settings, ...(isObj(raw.settings) ? (raw.settings as Partial<Settings>) : {}) };
  if (!isValidTimezone(settings.timezone)) settings.timezone = base.settings.timezone;
  if (settings.dayGrouping !== "cme" && settings.dayGrouping !== "midnight") settings.dayGrouping = "cme";
  if (settings.plan !== "pro") settings.plan = "free";
  const profile = { ...base.profile, ...(isObj(raw.profile) ? (raw.profile as Partial<Profile>) : {}) };
  return {
    version: DATA_VERSION,
    onboarded: Boolean(raw.onboarded),
    profile: {
      name: String(profile.name ?? ""),
      markets: arr<string>(profile.markets),
      strategies: arr<string>(profile.strategies),
      rulesText: String(profile.rulesText ?? ""),
    },
    settings,
    rules: arr<Rule>(raw.rules),
    guards: arr<AccountGuard>(raw.guards),
    executions: arr<Execution>(raw.executions).filter((e) => isObj(e) && typeof e.entryTime === "number"),
    cash: arr<CashEvent>(raw.cash),
    orders: arr<OrderEvent>(raw.orders),
    imports: arr<ImportRecord>(raw.imports),
    tradeNotes: rec<TradeNote>(raw.tradeNotes),
    journal: rec<DayJournal>(raw.journal),
    debriefs: rec<StoredDebrief>(raw.debriefs),
    playbook: isObj(raw.playbook) ? (raw.playbook as unknown as StoredPlaybook) : undefined,
    news: arr<NewsEvent>(raw.news),
    seenFiles: rec<number>(raw.seenFiles),
  };
}
