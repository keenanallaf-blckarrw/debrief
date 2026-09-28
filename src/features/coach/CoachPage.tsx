import { Lock, Send, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { Playbook, StoredPlaybook } from "../../../shared/ai/schemas";
import { Button } from "../../components/ui/Button";
import { Card, CardHeader } from "../../components/ui/Card";
import { Empty, Spinner } from "../../components/ui/Bits";
import { askInput, playbookInput } from "../../lib/aiInputs";
import { ai, useCompanion } from "../../lib/companion";
import { useDerived } from "../../lib/derived";
import { ago } from "../../lib/format";
import { PRO_FEATURES, usePro } from "../../lib/plan";
import { href } from "../../lib/router";
import { getData, openPro, savePlaybook, useStore } from "../../lib/store";

const SUGGESTIONS = [
  "What's my single most expensive habit?",
  "What happens to my size after two losses?",
  "Which hour should I stop trading?",
  "Am I better long or short, and why?",
  "What did my best week do differently?",
];

interface Msg {
  role: "user" | "assistant";
  content: string;
}

function Ask() {
  const derived = useDerived();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next);
    setQ("");
    setBusy(true);
    try {
      const { result } = await ai<string>("ask", askInput(getData(), derived, derived.trades, next, "pro"));
      setMsgs([...next, { role: "assistant", content: result }]);
    } catch (e) {
      toast.error((e as Error).message);
      setMsgs(next.slice(0, -1));
      setQ(question);
    } finally {
      setBusy(false);
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
    }
  };

  return (
    <Card className="flex min-h-[520px] flex-col">
      <CardHeader title="Ask your coach" subtitle="Anything about your own trading. Answers use your exact numbers." />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {!msgs.length && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)} className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:border-faint hover:text-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-soft text-ink" : "border border-gain/20 bg-gain/5 text-ink-2"}`}>{m.content}</div>
          </div>
        ))}
        {busy && <Spinner label="Checking your numbers…" />}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-line-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(q);
        }}
      >
        <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. "Why was Tuesday an F?"' aria-label="Your question" />
        <Button type="submit" variant="primary" icon={<Send className="size-4" />} disabled={!q.trim()} loading={busy}>
          Ask
        </Button>
      </form>
    </Card>
  );
}

function PlaybookCard() {
  const derived = useDerived();
  const stored = useStore((s) => s.data.playbook);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { result, model } = await ai<Playbook>("playbook", playbookInput(getData(), derived, derived.trades, "pro"));
      const rec: StoredPlaybook = { createdAt: Date.now(), model, tradeCount: derived.trades.length, result };
      savePlaybook(rec);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const b = stored?.result;
  return (
    <Card>
      <CardHeader
        eyebrow="Playbook decoder"
        title={b ? b.styleName : "Your strategy, decoded from your fills"}
        subtitle={b ? b.tagline : "The entries you actually take, your exits, your risk habits, and where what you say differs from what you do."}
        action={<Button size="sm" variant={b ? "ghost" : "primary"} loading={busy} disabled={derived.trades.length < 5} onClick={run}>{b ? "Rewrite" : "Decode my strategy"}</Button>}
      />
      <div className="px-5 pb-5 pt-3">
        {busy && !b && <Spinner label="Reading every trade, writing your playbook…" />}
        {derived.trades.length < 5 && !b && <p className="text-[13px] text-muted">Import at least 5 trades first. The more sessions, the sharper the playbook.</p>}
        {b && (
          <div className="animate-fade-in">
            {b.sections.map((s) => (
              <div key={s.title} className="border-t border-line-2 py-3">
                <div className="label mb-1">{s.title}</div>
                <p className="text-[13.5px] leading-relaxed text-ink-2">{s.body}</p>
              </div>
            ))}
            {b.gaps.length > 0 && (
              <div className="border-t border-line-2 py-3">
                <div className="label mb-2">What you say · what your fills show</div>
                {b.gaps.map((g, i) => (
                  <div key={i} className="mb-2">
                    <div className="text-[13px] italic text-muted">"{g.say}"</div>
                    <div className="text-[13.5px] text-amber">{g.fills}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-line-2 pt-3">
              <div className="label mb-2">Three rules to write down</div>
              <ol className="flex flex-col gap-2">
                {b.rules.slice(0, 3).map((r, i) => (
                  <li key={i} className="flex gap-3 text-[14px] font-medium">
                    <span className="font-mono text-amber">{String(i + 1).padStart(2, "0")}</span>
                    {r}
                  </li>
                ))}
              </ol>
              <a href={href("/rules")} className="mt-3 inline-block text-[12.5px] text-amber hover:underline">
                Add them on the Rules page →
              </a>
            </div>
            <div className="mt-3 text-[11.5px] text-faint">
              From {stored!.tradeCount} trades · {ago(stored!.createdAt)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function CoachPage() {
  const pro = usePro();
  const { available, status } = useCompanion();
  const trades = useDerived().trades;

  if (!pro) {
    return (
      <Card className="mx-auto max-w-2xl">
        <Empty
          icon={<Lock className="size-8 text-amber" />}
          title="The full AI coach is part of Debrief Pro"
          action={<Button variant="primary" onClick={() => openPro(true)}>Unlock Pro</Button>}
        >
          <ul className="mt-2 flex flex-col gap-1.5 text-left">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </Empty>
      </Card>
    );
  }
  if (!available || !status?.ai.ready) {
    return (
      <Card className="mx-auto max-w-2xl">
        <Empty icon={<Sparkles className="size-8" />} title="Turn on the AI coach">
          {available ? (
            <>Add your Anthropic API key in <a className="text-amber hover:underline" href={href("/settings")}>Settings</a>. It stays on your computer.</>
          ) : (
            <>The coach runs through the Debrief companion so your API key stays private. Start Debrief with <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[12px]">npm start</code>.</>
          )}
        </Empty>
      </Card>
    );
  }
  if (!trades.length) return <Card><Empty title="Import some trades first" /></Card>;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <div className="label">AI coach</div>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.025em]">Coach</h1>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Ask />
        <PlaybookCard />
      </div>
    </div>
  );
}
