import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Dialog";
import { checkCode, PRO_FEATURES } from "../../lib/plan";
import { openPro, setSettings, useStore } from "../../lib/store";

export function ProDialog() {
  const open = useStore((s) => s.proOpen);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const unlock = () => {
    if (checkCode(code)) {
      setSettings({ plan: "pro" });
      openPro(false);
      setCode("");
      setError("");
      toast.success("Debrief Pro unlocked.");
    } else {
      setError("That code doesn't match. Check with whoever sent you the beta invite.");
    }
  };
  return (
    <Modal open={open} onOpenChange={openPro} title="Debrief Pro" description="For traders who want the whole picture." width="max-w-[520px]">
      <ul className="flex flex-col gap-2.5">
        {PRO_FEATURES.map((f) => (
          <li key={f} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2">
            <Sparkles className="mt-1 size-3.5 shrink-0 text-amber" aria-hidden /> {f}
          </li>
        ))}
      </ul>
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          unlock();
        }}
      >
        <label className="label mb-1.5 block" htmlFor="pro-code">
          Beta unlock code
        </label>
        <div className="flex gap-2">
          <input id="pro-code" className="field flex-1 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" autoComplete="off" />
          <Button type="submit" variant="primary" disabled={!code.trim()}>
            Unlock
          </Button>
        </div>
        {error && <p className="mt-2 text-[12.5px] text-loss">{error}</p>}
        <p className="mt-3 text-[12px] text-faint">Pro is free during the beta. Payments come later.</p>
      </form>
    </Modal>
  );
}
