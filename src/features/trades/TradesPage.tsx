import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { summarize } from "../../../shared/analytics/stats";
import { addDays } from "../../../shared/util/time";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Empty, Money, Segmented } from "../../components/ui/Bits";
import { useDerived } from "../../lib/derived";
import { pct, plural } from "../../lib/format";
import { navigate } from "../../lib/router";
import { openImport, useStore } from "../../lib/store";
import { TradeDrawer } from "./TradeDrawer";
import { TradeList } from "./TradeList";

type Period = "7" | "30" | "90" | "all";
type Result = "all" | "wins" | "losses";
type RuleFilter = "all" | "broken" | "clean";

export function TradesPage({ openKey }: { openKey?: string }) {
  const derived = useDerived();
  const tz = useStore((s) => s.data.settings.timezone);
  const notes = useStore((s) => s.data.tradeNotes);
  const [period, setPeriod] = useState<Period>("all");
  const [result, setResult] = useState<Result>("all");
  const [rules, setRules] = useState<RuleFilter>("all");
  const [side, setSide] = useState<"all" | "Long" | "Short">("all");
  const [root, setRoot] = useState("all");
  const [query, setQuery] = useState("");

  const roots = useMemo(() => [...new Set(derived.trades.map((t) => t.root))].sort(), [derived.trades]);
  const latest = derived.days[0];
  const filtered = useMemo(() => {
    const from = period === "all" || !latest ? null : addDays(latest, -Number(period) + 1);
    const q = query.trim().toLowerCase();
    return derived.trades
      .filter((t) => !from || t.day >= from)
      .filter((t) => result === "all" || (result === "wins" ? t.net > 0 : t.net < 0))
      .filter((t) => side === "all" || t.side === side)
      .filter((t) => root === "all" || t.root === root)
      .filter((t) => {
        if (rules === "all") return true;
        const broken = derived.evaluation.byTrade.has(t.key);
        return rules === "broken" ? broken : !broken;
      })
      .filter((t) => {
        if (!q) return true;
        const n = notes[t.key];
        return [t.symbol, t.root, t.side, n?.notes, n?.emotion, ...(n?.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q);
      })
      .sort((a, b) => b.entryTime - a.entryTime);
  }, [derived, period, result, side, root, rules, query, notes, latest]);

  const s = summarize(filtered);
  const open = openKey ? derived.tradeByKey.get(openKey) ?? null : null;

  if (!derived.trades.length) {
    return (
      <Card>
        <Empty icon={<Download className="size-8" />} title="Your trades will show up here" action={<Button variant="primary" onClick={() => openImport(true)}>Import trades</Button>}>
          Every trade you import, with its chart, the rules it broke and your notes.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Journal</div>
          <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">Trades</h1>
        </div>
        <div className="text-right text-[13px] text-muted">
          {plural(s.trades, "trade")} · <Money value={s.net} className="font-semibold" /> · win rate {pct(s.winRate)}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<Period>
          size="sm"
          value={period}
          onChange={setPeriod}
          options={[
            { value: "7", label: "7 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
            { value: "all", label: "All" },
          ]}
        />
        <Segmented<Result>
          size="sm"
          value={result}
          onChange={setResult}
          options={[
            { value: "all", label: "All results" },
            { value: "wins", label: "Winners" },
            { value: "losses", label: "Losers" },
          ]}
        />
        <Segmented<RuleFilter>
          size="sm"
          value={rules}
          onChange={setRules}
          options={[
            { value: "all", label: "Any" },
            { value: "broken", label: "Broke a rule" },
            { value: "clean", label: "Clean" },
          ]}
        />
        <select className="field !h-8 !w-auto !py-0 text-[12.5px]" value={side} onChange={(e) => setSide(e.target.value as typeof side)} aria-label="Direction">
          <option value="all">Long & short</option>
          <option value="Long">Long only</option>
          <option value="Short">Short only</option>
        </select>
        {roots.length > 1 && (
          <select className="field !h-8 !w-auto !py-0 text-[12.5px]" value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Instrument">
            <option value="all">All instruments</option>
            {roots.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <input className="field !h-8 !w-48 !py-0 text-[12.5px]" placeholder="Search notes and tags" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes and tags" />
      </div>

      <Card>
        {filtered.length ? (
          <div className="pb-2 pt-2">
            <TradeList trades={filtered.slice(0, 500)} tz={tz} violations={derived.evaluation.byTrade} notes={notes} onOpen={(t) => navigate(`/trades/${t.key}`)} showDay showAccount={derived.accounts.length > 1} />
            {filtered.length > 500 && <p className="px-4 py-3 text-[12px] text-faint">Showing the latest 500. Narrow the filters to see older trades.</p>}
          </div>
        ) : (
          <Empty title="No trades match these filters" />
        )}
      </Card>
      <TradeDrawer trade={open} onClose={() => navigate("/trades", { replace: true })} />
    </div>
  );
}
