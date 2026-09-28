import { Download, KeyRound, RotateCcw, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { isValidTimezone } from "../../../shared/util/time";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Badge, Chip, Field, Segmented, Switch } from "../../components/ui/Bits";
import { companion, refreshStatus, useCompanion } from "../../lib/companion";
import { ago } from "../../lib/format";
import { usePro } from "../../lib/plan";
import { clearSample, getData, openPro, replaceAll, resetEverything, setProfile, setSettings, useStore } from "../../lib/store";
import { AutoImport } from "../import/AutoImport";
import { MARKETS, STRATEGIES } from "../onboarding/options";

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix",
  "America/Toronto", "America/Sao_Paulo", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Madrid",
  "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

function Profile() {
  const p = useStore((s) => s.data.profile);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Card>
      <CardHeader title="You" subtitle="The coach uses this to talk about your markets and your strategy." />
      <div className="flex flex-col gap-5 px-5 pb-5 pt-4">
        <Field label="Name">
          <input className="field max-w-sm" value={p.name} onChange={(e) => setProfile({ name: e.target.value })} />
        </Field>
        <div>
          <div className="label mb-2">Markets</div>
          <div className="flex flex-wrap gap-2">
            {MARKETS.map((m) => (
              <Chip key={m} active={p.markets.includes(m)} onClick={() => setProfile({ markets: toggle(p.markets, m) })}>
                {m}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">Strategies</div>
          <div className="flex flex-wrap gap-2">
            {STRATEGIES.map((m) => (
              <Chip key={m} active={p.strategies.includes(m)} onClick={() => setProfile({ strategies: toggle(p.strategies, m) })}>
                {m}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function TimeAndCosts() {
  const s = useStore((x) => x.data.settings);
  const known = TIMEZONES.includes(s.timezone);
  return (
    <Card>
      <CardHeader title="Time and costs" subtitle="How Debrief reads your exports." />
      <div className="flex flex-col gap-5 px-5 pb-5 pt-4">
        <Field label="Timezone of your exports" hint="Tradovate and TradingView write times in the timezone set in their app, usually your computer's. Debrief shows every time in this zone.">
          <select className="field max-w-sm" value={s.timezone} onChange={(e) => isValidTimezone(e.target.value) && setSettings({ timezone: e.target.value })}>
            {!known && <option value={s.timezone}>{s.timezone}</option>}
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <div className="label mb-2">What counts as one trading day</div>
          <Segmented
            value={s.dayGrouping}
            onChange={(v) => setSettings({ dayGrouping: v })}
            options={[
              { value: "cme", label: "Futures day (6 PM ET roll)" },
              { value: "midnight", label: "Calendar day" },
            ]}
          />
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-faint">
            Futures trade from 6 PM to 5 PM New York time, so an 8 PM gold trade belongs to the next day. That's how your broker's Trade Date and prop firm daily limits work.
          </p>
        </div>
        <Field label="Commission per contract, per side" hint="Used only when you haven't imported Tradovate's Cash History (which has your real costs). Micros are often $0.25–$0.62 per side.">
          <span className="inline-flex items-center gap-2">
            <span className="text-muted">$</span>
            <input type="number" min={0} step={0.01} className="field !w-28 font-mono" value={s.commissionPerSide} onChange={(e) => setSettings({ commissionPerSide: Math.max(0, Number(e.target.value)) })} />
          </span>
        </Field>
      </div>
    </Card>
  );
}

function Companion() {
  const { available, status } = useCompanion();
  const settings = useStore((s) => s.data.settings);
  const [key, setKey] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);

  if (!available || !status) {
    return (
      <Card>
        <CardHeader title="Debrief companion" subtitle="Not running" />
        <div className="px-5 pb-5 pt-3 text-[13.5px] leading-relaxed text-muted">
          The companion is a small program that runs on your computer. It imports exports from your Downloads folder automatically, runs the AI coach with your own key, loads price charts and saves the news calendar.
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-2">
            <li>Open the Terminal app.</li>
            <li>
              Type <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px]">cd ~/debrief</code> and press Return.
            </li>
            <li>
              Type <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px]">npm start</code> and press Return.
            </li>
          </ol>
          <p className="mt-3">Debrief opens at http://localhost:4317. Your journal there starts empty; use Export backup below to bring this one over.</p>
        </div>
      </Card>
    );
  }

  const saveKey = async () => {
    setBusy(true);
    try {
      const r = await companion.saveKey(key);
      toast.success(r.message);
      setKey("");
      await refreshStatus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Debrief companion" subtitle={`Running · version ${status.version} · your files in ${status.dataDir}`} action={<Badge tone="gain">on</Badge>} />
      <div className="flex flex-col gap-6 px-5 pb-5 pt-4">
        <AutoImport />
        <Field label="Folder to watch" hint="Most browsers save exports to Downloads.">
          <span className="flex max-w-xl gap-2">
            <input className="field font-mono text-[12.5px]" placeholder={status.watch.dir} value={dir} onChange={(e) => setDir(e.target.value)} />
            <Button
              size="md"
              disabled={!dir.trim()}
              onClick={async () => {
                try {
                  await companion.setWatch({ dir });
                  setDir("");
                  await refreshStatus();
                  toast.success("Now watching that folder.");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Change
            </Button>
          </span>
        </Field>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">Save price charts for new trades</div>
            <p className="text-[12px] text-faint">Free 1-minute candles disappear after 30 days, so Debrief saves them right after each import.</p>
          </div>
          <Switch checked={settings.prefetchCharts} onChange={(v) => setSettings({ prefetchCharts: v })} label="Save price charts" />
        </div>

        <div className="rounded-2xl border border-line-2 bg-panel p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <KeyRound className="size-4 text-amber" aria-hidden /> AI coach
            </div>
            {status.ai.ready ? <Badge tone="gain">on · {status.ai.model}</Badge> : <Badge>off</Badge>}
          </div>
          {status.ai.ready ? (
            <div className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {status.ai.source === "environment" ? "Using the ANTHROPIC_API_KEY set in your environment." : "Using the key saved in your Debrief folder (readable only by you)."} AI requests are billed to your Anthropic account; a session debrief costs a few cents.
              {status.ai.source === "saved" && (
                <Button size="sm" variant="ghost" className="ml-2" onClick={async () => { await companion.deleteKey(); await refreshStatus(); toast("AI key removed."); }}>
                  Remove key
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted">
                <li>
                  Go to <a className="text-amber hover:underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>, sign in, and click Create Key.
                </li>
                <li>Copy the key (it starts with sk-ant-) and paste it here.</li>
              </ol>
              <form className="mt-3 flex max-w-xl gap-2" onSubmit={(e) => { e.preventDefault(); void saveKey(); }}>
                <input type="password" className="field font-mono text-[12.5px]" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" aria-label="Anthropic API key" />
                <Button type="submit" variant="primary" disabled={!key.trim()} loading={busy}>
                  Save key
                </Button>
              </form>
              <p className="mt-2 text-[12px] text-faint">The key is checked, then saved on your computer only. It never goes into the browser or the repo.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">Debrief automatically after auto-import</div>
            <p className="text-[12px] text-faint">Off by default because each debrief is an AI request on your account.</p>
          </div>
          <Switch checked={settings.autoDebrief} onChange={(v) => setSettings({ autoDebrief: v })} label="Auto debrief" />
        </div>
      </div>
    </Card>
  );
}

function Data() {
  const { available, status } = useCompanion();
  const file = useRef<HTMLInputElement>(null);
  const hasSample = useStore((s) => s.data.executions.some((e) => e.format === "sample"));
  const [confirm, setConfirm] = useState("");

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ app: "debrief", savedAt: Date.now(), data: getData() }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `debrief-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restoreFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      const d = replaceAll(parsed?.data ?? parsed);
      toast.success(`Restored ${d.executions.length} fills and ${d.rules.length} rules.`);
    } catch {
      toast.error("That file isn't a Debrief backup.");
    }
  };

  return (
    <Card>
      <CardHeader title="Your data" subtitle="Your journal lives in this browser. Nothing is uploaded anywhere." />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download className="size-4" />} onClick={exportBackup}>
            Export backup
          </Button>
          <Button icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>
            Restore from a backup file
          </Button>
          <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void restoreFile(e.target.files?.[0])} />
          {available && status?.backups.latest && (
            <Button
              icon={<RotateCcw className="size-4" />}
              onClick={async () => {
                try {
                  const b = await companion.latestBackup();
                  const d = replaceAll(b.data);
                  toast.success(`Restored the backup from ${ago(b.savedAt)} (${d.executions.length} fills).`);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Restore companion backup ({ago(status.backups.latest)})
            </Button>
          )}
          {hasSample && (
            <Button variant="ghost" onClick={clearSample}>
              Remove sample data
            </Button>
          )}
        </div>
        {available && <p className="text-[12px] text-faint">The companion also keeps a daily copy in {status?.dataDir}/backups.</p>}
        <div className="rounded-2xl border border-loss/25 p-4">
          <div className="text-[13.5px] font-semibold text-loss">Delete everything</div>
          <p className="mt-1 text-[12.5px] text-muted">Removes every trade, rule, note and debrief from this browser. Type DELETE to confirm.</p>
          <div className="mt-2 flex max-w-sm gap-2">
            <input className="field font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" />
            <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={confirm !== "DELETE"} onClick={() => { resetEverything(); setConfirm(""); }}>
              Delete
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const pro = usePro();
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <div className="label">Settings</div>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">Settings</h1>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Companion />
          <Data />
        </div>
        <div className="flex flex-col gap-4">
          <Profile />
          <TimeAndCosts />
          <Card>
            <CardHeader title="Plan" subtitle={pro ? "Debrief Pro is unlocked." : "You're on the free plan."} />
            <div className="flex gap-2 px-5 pb-5 pt-4">
              {pro ? (
                <Button variant="ghost" onClick={() => setSettings({ plan: "free" })}>
                  Switch back to free (for testing)
                </Button>
              ) : (
                <Button variant="primary" onClick={() => openPro(true)}>
                  Unlock Pro
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
