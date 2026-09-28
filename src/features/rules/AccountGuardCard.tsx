import { ShieldAlert, ShieldCheck, Trash2, Trophy } from "lucide-react";
import { detectStartBalance, evaluateGuard } from "../../../shared/rules/account";
import { maskAccount } from "../../../shared/trades/roundtrips";
import type { AccountGuard } from "../../../shared/types";
import { uid } from "../../../shared/util/hash";
import { Button } from "../../components/ui/Button";
import { Field, Info } from "../../components/ui/Bits";
import { Meter } from "../../components/ui/Stat";
import { useDerived } from "../../lib/derived";
import { money } from "../../lib/format";
import { deleteGuard, getData, upsertGuard, useStore } from "../../lib/store";

// Prop-firm account limits. Values are typical starting points; every firm's
// rules differ and change, so check yours and edit the numbers.

export function newGuard(account = ""): AccountGuard {
  const start = detectStartBalance(getData().cash, account) ?? 50000;
  return {
    id: uid("g_"),
    name: account ? `Account ${maskAccount(account)}` : "My evaluation",
    account,
    startBalance: start,
    dailyLossLimit: Math.round(start * 0.02),
    maxDrawdown: Math.round(start * 0.04),
    drawdownMode: "trailingEod",
    lockAtStart: true,
    profitTarget: Math.round(start * 0.06),
  };
}

function Num({ label, value, onChange, help }: { label: string; value: number | undefined; onChange: (n: number | undefined) => void; help?: string }) {
  return (
    <Field label={<span className="inline-flex items-center gap-1">{label} {help && <Info>{help}</Info>}</span>}>
      <input
        type="number"
        className="field !py-1.5 font-mono text-[13px]"
        value={value ?? ""}
        placeholder="off"
        onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)))}
      />
    </Field>
  );
}

export function AccountGuardCard({ guard }: { guard: AccountGuard }) {
  const { allTrades, accounts } = useDerived();
  const cash = useStore((s) => s.data.cash);
  const s = evaluateGuard(guard, allTrades);
  const save = (patch: Partial<AccountGuard>) => upsertGuard({ ...guard, ...patch });
  const Icon = s.status === "breached" ? ShieldAlert : s.status === "passed" ? Trophy : ShieldCheck;
  const tone = s.status === "breached" ? "text-loss" : s.status === "warning" ? "text-warn" : "text-gain";
  const detected = detectStartBalance(cash, guard.account);

  return (
    <div className="rounded-[20px] border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className={`size-6 ${tone}`} aria-hidden />
          <div>
            <input className="bg-transparent text-[16px] font-semibold outline-none focus:underline" value={guard.name} onChange={(e) => save({ name: e.target.value })} aria-label="Guard name" />
            <div className="text-[12.5px] text-muted">
              {s.status === "breached" ? "A limit was hit" : s.status === "passed" ? "Profit target reached" : s.status === "warning" ? "Close to a limit" : "Inside every limit"} · {s.trades} trades · balance {money(s.balance)}
            </div>
          </div>
        </div>
        <button type="button" className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-soft hover:text-loss" aria-label="Delete this guard" onClick={() => deleteGuard(guard.id)}>
          <Trash2 className="size-4" />
        </button>
      </div>

      {!guard.account && accounts.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-[12.5px] text-ink-2">
          This guard is adding up {accounts.length} accounts. Prop firm limits apply per account, so pick the one it's for:
          <select className="field !h-8 !w-auto !py-0 text-[12.5px]" value="" onChange={(e) => save({ account: e.target.value, name: guard.name === "My evaluation" ? `Account ${maskAccount(e.target.value)}` : guard.name })} aria-label="Account for this guard">
            <option value="" disabled>
              Choose account
            </option>
            {accounts.map((a) => (
              <option key={a} value={a}>
                {maskAccount(a)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {guard.dailyLossLimit ? (
          <div>
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="text-muted">Daily loss ({s.today?.day ?? "latest day"})</span>
              <span className="font-mono tnum">{money(Math.max(0, -(s.today?.net ?? 0)))} / {money(guard.dailyLossLimit)}</span>
            </div>
            <Meter value={Math.max(0, -(s.today?.net ?? 0))} max={guard.dailyLossLimit} tone={(s.today?.lossRoom ?? 1) <= 0 ? "loss" : (s.today?.lossRoom ?? 0) < guard.dailyLossLimit * 0.3 ? "warn" : "gain"} label="Daily loss used" />
          </div>
        ) : null}
        {s.threshold !== null ? (
          <div>
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="text-muted">Drawdown room</span>
              <span className="font-mono tnum">{money(s.drawdownRoom)} left</span>
            </div>
            <Meter value={Math.max(0, s.drawdownRoom ?? 0)} max={guard.maxDrawdown ?? 1} tone={(s.drawdownRoom ?? 0) <= 0 ? "loss" : (s.drawdownRoom ?? 0) < (guard.maxDrawdown ?? 0) * 0.3 ? "warn" : "gain"} label="Drawdown room left" />
            <div className="mt-1 text-[11.5px] text-faint">Fails below {money(s.threshold)}</div>
          </div>
        ) : null}
        {guard.profitTarget ? (
          <div>
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="text-muted">Profit target</span>
              <span className="font-mono tnum">{money(s.profit)} / {money(guard.profitTarget)}</span>
            </div>
            <Meter value={Math.max(0, s.profit)} max={guard.profitTarget} tone="amber" label="Progress to profit target" />
            {s.consistency && <div className="mt-1 text-[11.5px] text-faint">Best day is {s.consistency.bestDayShare}% of profit</div>}
          </div>
        ) : null}
      </div>

      {s.breaches.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1 rounded-xl border border-loss/25 bg-loss/5 px-3 py-2 text-[12.5px] text-loss">
          {s.breaches.slice(0, 5).map((b, i) => (
            <li key={i}>
              {b.day}: {b.message}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">Edit this account's rules</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Account">
            <select className="field !py-1.5 text-[13px]" value={guard.account} onChange={(e) => save({ account: e.target.value })}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {maskAccount(a)}
                </option>
              ))}
            </select>
          </Field>
          <Num label="Starting balance" value={guard.startBalance} onChange={(v) => save({ startBalance: v ?? 0 })} help={detected ? `Your Cash History shows a first deposit of ${money(detected)}.` : "Import Tradovate's Cash History to fill this in automatically."} />
          <Num label="Daily loss limit" value={guard.dailyLossLimit} onChange={(v) => save({ dailyLossLimit: v })} />
          <Num label="Max drawdown" value={guard.maxDrawdown} onChange={(v) => save({ maxDrawdown: v })} />
          <Field label="Drawdown type">
            <select className="field !py-1.5 text-[13px]" value={guard.drawdownMode} onChange={(e) => save({ drawdownMode: e.target.value as AccountGuard["drawdownMode"] })}>
              <option value="trailingEod">Trailing, end of day</option>
              <option value="trailingIntraday">Trailing, intraday</option>
              <option value="static">Static</option>
            </select>
          </Field>
          <Field label="Stop trailing at start">
            <select className="field !py-1.5 text-[13px]" value={guard.lockAtStart ? "yes" : "no"} onChange={(e) => save({ lockAtStart: e.target.value === "yes" })}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
          <Num label="Profit target" value={guard.profitTarget} onChange={(v) => save({ profitTarget: v })} />
          <Num label="Max contracts" value={guard.maxContracts} onChange={(v) => save({ maxContracts: v })} />
          <Num label="Consistency % (best day)" value={guard.consistencyPct} onChange={(v) => save({ consistencyPct: v })} help="Some firms cap how much of your total profit can come from one day, e.g. 40%." />
          <Field label="Count trades from">
            <input type="date" className="field !py-1.5 font-mono text-[13px]" value={guard.startDay ?? ""} onChange={(e) => save({ startDay: e.target.value || undefined })} />
          </Field>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          Debrief checks closed trades only. Firms also count open-trade swings, so treat these meters as a floor, and confirm your firm's current rules.
        </p>
      </details>
    </div>
  );
}

export function AddGuardButton() {
  const { accounts } = useDerived();
  return (
    <Button size="sm" onClick={() => upsertGuard(newGuard(accounts.length === 1 ? accounts[0] : ""))}>
      Add an account guard
    </Button>
  );
}
