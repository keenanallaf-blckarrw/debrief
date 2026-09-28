import { CalendarClock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { MarketBrief } from "../../../shared/ai/schemas";
import { parseSymbol } from "../../../shared/instruments";
import type { NewsEvent } from "../../../shared/types";
import { tradingDay } from "../../../shared/util/time";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Segmented, Spinner } from "../../components/ui/Bits";
import { marketBriefInput } from "../../lib/aiInputs";
import { ai, companion, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { dayShort, duration, timeOf, tzShort } from "../../lib/format";
import { addNews, getData, useStore } from "../../lib/store";
import { LiveChart } from "../../charts/LiveChart";
import { TradingViewWidget, widgetSymbol } from "./TradingViewWidget";

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function WeekCalendar({ events, tz }: { events: NewsEvent[]; tz: string }) {
  const [impact, setImpact] = useState<"high" | "medium">("high");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const { trades } = useDerived();
  const now = useNow();
  const currencies = useMemo(() => {
    const set = new Set<string>(["USD"]);
    for (const t of trades.slice(-200)) {
      const info = parseSymbol(t.symbol);
      if (info.spec) for (const c of info.spec.newsCurrencies) set.add(c);
    }
    return set;
  }, [trades]);

  const today = tradingDay(now, tz, "midnight");
  const shown = events.filter(
    (e) => (impact === "high" ? e.impact === "high" : e.impact === "high" || e.impact === "medium") && (scope === "all" || currencies.has(e.currency)),
  );
  const next = shown.find((e) => e.time > now && e.impact === "high");
  const byDay = new Map<string, NewsEvent[]>();
  for (const e of shown) {
    const d = tradingDay(e.time, tz, "midnight");
    const list = byDay.get(d) ?? [];
    list.push(e);
    byDay.set(d, list);
  }

  return (
    <Card>
      <CardHeader
        title="This week's calendar"
        eyebrow={<span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" /> Forex Factory</span>}
        subtitle={next ? `Next high-impact release: ${next.title} (${next.currency}) in ${duration(next.time - now)}, at ${timeOf(next.time, tz)} ${tzShort(tz)}.` : "No more high-impact releases this week."}
        action={
          <div className="hidden gap-2 sm:flex">
            <Segmented size="sm" value={impact} onChange={setImpact} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium+" }]} />
            <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: "mine", label: "My markets" }, { value: "all", label: "All" }]} />
          </div>
        }
      />
      <div className="px-5 pb-5 pt-3">
        {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => (
          <div key={day} className={`mb-4 ${day < today ? "opacity-50" : ""}`}>
            <div className={`label mb-1.5 ${day === today ? "!text-amber" : ""}`}>{day === today ? `Today · ${dayShort(day)}` : dayShort(day)}</div>
            <ul className="flex flex-col divide-y divide-line-2 rounded-2xl border border-line-2 bg-panel">
              {list.map((e) => (
                <li key={e.id} className={`flex items-center gap-3 px-3 py-2 text-[13px] ${e.time < now ? "text-faint" : ""}`}>
                  <span className="w-[70px] shrink-0 font-mono text-[12px] tnum text-muted">{timeOf(e.time, tz)}</span>
                  <span className={`size-2 shrink-0 rounded-full ${e.impact === "high" ? "bg-loss" : "bg-warn"}`} aria-label={`${e.impact} impact`} />
                  <span className="w-9 shrink-0 font-mono text-[11.5px] text-muted">{e.currency}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{e.title}</span>
                  {(e.forecast || e.previous) && (
                    <span className="hidden shrink-0 font-mono text-[11.5px] text-faint sm:inline">
                      {e.forecast ? `f ${e.forecast}` : ""} {e.previous ? `p ${e.previous}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!byDay.size && <p className="text-[13px] text-muted">Nothing on the calendar for this filter.</p>}
      </div>
    </Card>
  );
}

function BriefCard({ events }: { events: NewsEvent[] }) {
  const { available, status } = useCompanion();
  const tz = useStore((s) => s.data.settings.timezone);
  const strategies = useStore((s) => s.data.profile.strategies);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<MarketBrief | null>(null);
  if (!available || !status?.ai.ready) return null;
  const run = async () => {
    setBusy(true);
    try {
      const today = tradingDay(Date.now(), tz, "midnight");
      const { result } = await ai<MarketBrief>("market-brief", marketBriefInput(getData(), events, today));
      setBrief(result);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        eyebrow={<span className="inline-flex items-center gap-1.5 !text-gain"><Sparkles className="size-3.5" /> AI coach</span>}
        title={brief ? brief.headline : "Today's brief"}
        subtitle={brief ? undefined : "The calendar and headlines, translated into what days like today have meant for how you trade. Context, never signals."}
        action={<Button size="sm" variant={brief ? "ghost" : "primary"} loading={busy} onClick={run}>{brief ? "Refresh" : "Run today's brief"}</Button>}
      />
      <div className="px-5 pb-5 pt-3">
        {busy && !brief && <Spinner label="Reading today's calendar and headlines…" />}
        {brief && (
          <div className="animate-fade-in">
            <p className="text-[14px] leading-relaxed text-ink-2">{brief.read}</p>
            {brief.events.length > 0 && (
              <ul className="mt-4 flex flex-col divide-y divide-line-2">
                {brief.events.slice(0, 5).map((e, i) => (
                  <li key={i} className="flex gap-3 py-3 text-[13px]">
                    <span className="w-[72px] shrink-0 font-mono text-[12px] text-muted">{e.time}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">{e.name}</span>
                      <span className="block text-muted">{e.plain}</span>
                      <span className="mt-1 block text-ink-2">
                        <span className="label mr-2 !text-amber">Past tendency</span>
                        {e.usually}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 rounded-2xl bg-soft px-4 py-3">
              <div className="label mb-1">For your {strategies.slice(0, 2).join(" + ") || "strategy"}</div>
              <p className="text-[13.5px] leading-relaxed text-ink-2">{brief.strategyNote}</p>
            </div>
            {brief.windows.length > 0 && (
              <div className="mt-3 rounded-2xl border border-amber/30 bg-amber/5 px-4 py-3">
                <div className="label mb-1.5 !text-amber">Stand-aside windows</div>
                <ul className="flex flex-col gap-1 text-[13px]">
                  {brief.windows.slice(0, 3).map((w, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-[120px] shrink-0 font-mono text-[12px] text-ink">{w.span}</span>
                      <span className="text-muted">{w.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[11.5px] text-faint">Context for your plan. Debrief never gives buy or sell signals.</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function MarketPage() {
  const { available } = useCompanion();
  const tz = useStore((s) => s.data.settings.timezone);
  const news = useStore((s) => s.data.news);
  const { trades } = useDerived();
  const [refreshing, setRefreshing] = useState(false);

  const roots = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of trades.slice(-300)) count.set(t.root, (count.get(t.root) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  }, [trades]);
  const [root, setRoot] = useState<string | null>(null);
  const chartRoot = root ?? roots[0] ?? "MNQ";
  const proxy = widgetSymbol(chartRoot, parseSymbol(chartRoot).assetClass);

  const now = Date.now();
  const week = news.filter((e) => Math.abs(e.time - now) < 8 * 86_400_000).sort((a, b) => a.time - b.time);

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Before you trade</div>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">Market</h1>
        </div>
        {available && (
          <Button
            size="sm"
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                addNews((await companion.calendar(true)).events);
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setRefreshing(false);
              }
            }}
          >
            Refresh calendar
          </Button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {available && week.length ? (
            <WeekCalendar events={week} tz={tz} />
          ) : (
            <Card>
              <CardHeader
                title="Economic calendar"
                subtitle={available ? "Fetching this week's calendar…" : "Live from TradingView. Run the Debrief companion to save the calendar and check your trades against it automatically."}
              />
              <div className="p-3">
                <TradingViewWidget script="events" height={520} title="TradingView economic calendar" config={{ colorTheme: "dark", isTransparent: true, locale: "en", importanceFilter: "0,1", countryFilter: "us,eu,gb,jp,cn" }} />
              </div>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <BriefCard events={news} />
          <Card>
            <CardHeader
              title={`Live chart · ${chartRoot}`}
              subtitle={available ? "Today's 1-minute futures candles for the market you trade most." : `TradingView's live chart of ${proxy.note}, the closest free stand-in for ${chartRoot} futures.`}
              action={
                roots.length > 1 ? (
                  <select className="field !h-8 !w-auto !py-0 text-[12.5px]" value={chartRoot} onChange={(e) => setRoot(e.target.value)} aria-label="Chart symbol">
                    {roots.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : undefined
              }
            />
            <div className="p-3">
              {available ? (
                <LiveChart symbol={chartRoot} tz={tz} />
              ) : (
                <TradingViewWidget
                  script="advanced-chart"
                  height={460}
                  title={`TradingView chart for ${proxy.symbol}`}
                  config={{ symbol: proxy.symbol, interval: "5", timezone: tz, theme: "dark", style: "1", locale: "en", backgroundColor: "rgba(11, 11, 12, 1)", gridColor: "rgba(255, 255, 255, 0.04)", allow_symbol_change: true, hide_side_toolbar: true, support_host: "https://www.tradingview.com" }}
                />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
