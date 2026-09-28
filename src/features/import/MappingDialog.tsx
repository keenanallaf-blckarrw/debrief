import { useEffect, useMemo, useState } from "react";
import type { ColumnMapping, FillMapping, RoundTripMapping } from "../../../shared/import/types";
import { Button } from "../../components/ui/Button";
import { Badge, Field, Switch } from "../../components/ui/Bits";
import { Modal } from "../../components/ui/Dialog";
import { money, plural } from "../../lib/format";
import { importWithMapping, previewMapping } from "../../lib/importer";
import { dropMapping, useStore } from "../../lib/store";

// For exports Debrief hasn't seen before: confirm which column is which, see a
// live preview of the trades it will create, then import.

const ROUNDTRIP_FIELDS: [keyof RoundTripMapping, string, boolean][] = [
  ["symbol", "Instrument", true],
  ["side", "Long / short", false],
  ["qty", "Size", false],
  ["entryPrice", "Entry price", false],
  ["exitPrice", "Exit price", false],
  ["pnl", "P&L", false],
  ["entryTime", "Entry time", false],
  ["exitTime", "Exit time", false],
  ["account", "Account", false],
];

const FILL_FIELDS: [keyof FillMapping, string, boolean][] = [
  ["symbol", "Instrument", true],
  ["side", "Buy / sell", true],
  ["qty", "Quantity", true],
  ["price", "Fill price", true],
  ["time", "Fill time", true],
  ["status", "Status", false],
  ["commission", "Commission", false],
  ["account", "Account", false],
];

export function MappingDialog() {
  const pending = useStore((s) => s.mappings[0]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  useEffect(() => {
    setMapping(pending?.analysis.suggested ?? null);
  }, [pending?.id]);

  const preview = useMemo(() => (pending && mapping ? previewMapping(pending.analysis, mapping) : null), [pending, mapping]);
  if (!pending || !mapping) return null;
  const { table, fileName } = pending.analysis;
  const fields = mapping.layout === "fills" ? FILL_FIELDS : ROUNDTRIP_FIELDS;
  const sample = table.rows[0] ?? {};
  const set = (key: string, value: string) => setMapping({ ...mapping, [key]: value || undefined } as ColumnMapping);
  const missingRequired = fields.some(([k, , req]) => req && !(mapping as unknown as Record<string, string | undefined>)[k as string]);

  return (
    <Modal
      open
      onOpenChange={(o) => !o && dropMapping(pending.id)}
      title="Check the columns"
      description={`${fileName} · ${plural(table.rows.length, "row")}. Debrief hasn't seen this layout before, so confirm it once.`}
      width="max-w-[820px]"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-muted">Each row is</span>
        <div className="inline-flex rounded-xl border border-line bg-panel p-0.5">
          {(["roundtrip", "fills"] as const).map((layout) => (
            <button
              key={layout}
              type="button"
              onClick={() =>
                setMapping(
                  layout === mapping.layout
                    ? mapping
                    : layout === "fills"
                      ? { layout: "fills", symbol: mapping.symbol, side: (mapping as RoundTripMapping).side ?? "", qty: (mapping as RoundTripMapping).qty ?? "", price: "", time: "" }
                      : { layout: "roundtrip", symbol: mapping.symbol },
                )
              }
              className={`cursor-pointer rounded-[10px] px-3 py-1.5 text-[12.5px] ${mapping.layout === layout ? "bg-soft text-ink" : "text-muted"}`}
            >
              {layout === "roundtrip" ? "a whole trade (entry and exit)" : "one buy or sell"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, label, required]) => {
          const value = (mapping as unknown as Record<string, string | undefined>)[key as string] ?? "";
          return (
            <Field key={key as string} label={`${label}${required ? " *" : ""}`} hint={value ? `e.g. ${String(sample[value] ?? "").slice(0, 40) || "(empty)"}` : "not used"}>
              <select value={value} onChange={(e) => set(key as string, e.target.value)} className="field !py-2 text-[13px]">
                <option value="">(none)</option>
                {table.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </Field>
          );
        })}
      </div>

      {mapping.layout === "roundtrip" && (
        <div className="mt-4 flex items-center gap-3 text-[13px]">
          <Switch checked={Boolean(mapping.flip)} onChange={(v) => setMapping({ ...mapping, flip: v })} label="Flip long and short" />
          Directions look backwards? Flip long and short.
          {!mapping.side && <span className="text-faint">(With no side column, Debrief works direction out from the P&L sign.)</span>}
        </div>
      )}

      <div className="mt-6">
        <div className="label mb-2">Preview</div>
        {preview && preview.executions.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line-2">
            <table className="w-full text-[12.5px] tnum">
              <thead className="bg-panel text-left text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Instrument</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">Entry → exit</th>
                  <th className="px-3 py-2 text-right font-medium">P&L</th>
                </tr>
              </thead>
              <tbody>
                {preview.executions.slice(0, 5).map((e, i) => (
                  <tr key={i} className="border-t border-line-2">
                    <td className="px-3 py-2">{e.symbol} <span className="text-faint">({e.root})</span></td>
                    <td className="px-3 py-2"><Badge tone={e.side === "Long" ? "gain" : "loss"}>{e.side}</Badge></td>
                    <td className="px-3 py-2">{e.qty}</td>
                    <td className="px-3 py-2 text-muted">{e.entryPrice} → {e.exitPrice}</td>
                    <td className={`px-3 py-2 text-right ${e.pnl >= 0 ? "text-gain" : "text-loss"}`}>{money(e.pnl, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line-2 px-3 py-2 text-[12px] text-muted">
              {plural(preview.executions.length, "trade")} will be imported
              {preview.skippedRows ? ` · ${preview.skippedRows} rows skipped` : ""}
              {preview.openPositions ? ` · ${preview.openPositions} contracts still open` : ""}
            </div>
          </div>
        ) : (
          <p className="rounded-2xl border border-line-2 px-4 py-6 text-center text-[13px] text-muted">
            {preview?.warnings[0] ?? "No trades yet with this mapping. Pick the instrument, prices and times."}
          </p>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => dropMapping(pending.id)}>
          Skip this file
        </Button>
        <Button variant="primary" disabled={missingRequired || !preview?.executions.length} onClick={() => importWithMapping(pending.id, mapping)}>
          Import {preview?.executions.length ? plural(preview.executions.length, "trade") : ""}
        </Button>
      </div>
    </Modal>
  );
}
