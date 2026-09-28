import { toast } from "sonner";
import type { DayDebrief, StoredDebrief } from "../../shared/ai/schemas";
import { dayDebriefInput } from "./aiInputs";
import { ai, useCompanion } from "./companion";
import { derive } from "./derived";
import { dayShort } from "./format";
import { navigate } from "./router";
import { getData, saveDebrief } from "./store";

// "Debrief automatically after auto-import": when a new export lands and the
// setting is on, the coach writes that session's debrief without a click.

const running = new Set<string>();

export async function autoDebrief(day: string): Promise<void> {
  const data = getData();
  const status = useCompanion.getState().status;
  if (!data.settings.autoDebrief || !status?.ai.ready) return;
  const derived = derive(data);
  const tier = data.settings.plan === "pro" ? "pro" : "free";
  for (const ev of derived.dayEvaluations(day)) {
    const key = `day:${ev.day}|${ev.account}`;
    if (running.has(key)) continue;
    running.add(key);
    try {
      const { result, model } = await ai<DayDebrief>("day-debrief", dayDebriefInput(data, derived, ev, tier));
      const record: StoredDebrief = { key, kind: "day", label: ev.day, createdAt: Date.now(), model, tier, day: result };
      saveDebrief(record);
      toast.success(`Your coach debriefed ${dayShort(ev.day)}: ${result.headline}`, {
        duration: 10_000,
        action: { label: "Read it", onClick: () => navigate(`/day/${ev.day}`) },
      });
    } catch (e) {
      toast.error(`Auto-debrief didn't run: ${(e as Error).message}`);
    } finally {
      running.delete(key);
    }
  }
}
