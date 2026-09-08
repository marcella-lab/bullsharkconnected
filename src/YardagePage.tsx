import { Download, Plus, Printer, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type {
  BootstrapPayload,
  YardageRow,
  YardageStatus,
} from "./types";
type Mutate = <T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
) => Promise<T>;
type Draft = Pick<
  YardageRow,
  | "status"
  | "state"
  | "concreteCompany"
  | "client"
  | "projectId"
  | "dimensions"
  | "thickness"
  | "secondaryDimensions"
  | "secondaryThickness"
  | "secondarySectionType"
  | "noPourDimensions"
  | "noPourThickness"
  | "keepFooterAroundNoPour"
  | "footers"
  | "additionalConcreteYardage"
  | "wastePercent"
  | "notes"
>;
const blank: Draft = {
  status: "ACTIVE",
  state: "",
  concreteCompany: "",
  client: "",
  projectId: "",
  dimensions: "",
  thickness: 6,
  secondaryDimensions: "",
  secondaryThickness: 0,
  secondarySectionType: "inside",
  noPourDimensions: "",
  noPourThickness: 0,
  keepFooterAroundNoPour: true,
  footers: "",
  additionalConcreteYardage: 0,
  wastePercent: 0,
  notes: "",
};
const cy = (n: number) => `${(n || 0).toFixed(2)} CY`;
const dimensionPair = (value: string) => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i);
  return match ? [Number(match[1]), Number(match[2])] as const : null;
};
const previewYardage = (draft: Draft) => {
  const primary = dimensionPair(draft.dimensions);
  const footer = dimensionPair(draft.footers);
  const secondary = draft.secondaryDimensions.trim() ? dimensionPair(draft.secondaryDimensions) : null;
  const noPour = draft.noPourDimensions.trim() ? dimensionPair(draft.noPourDimensions) : null;
  if (!primary || !footer || !(draft.thickness > 0)) return null;
  const totalSquareFeet = primary[0] * primary[1];
  const secondarySquareFeet = secondary ? secondary[0] * secondary[1] : 0;
  const noPourSquareFeet = noPour ? noPour[0] * noPour[1] : 0;
  if (draft.secondarySectionType === "inside" && secondarySquareFeet > totalSquareFeet) return { error: "An inside secondary area cannot exceed the main slab area." };
  if (draft.secondaryDimensions.trim() && !(draft.secondaryThickness > 0)) return { error: "Enter a secondary thickness greater than zero." };
  if (noPourSquareFeet > totalSquareFeet) return { error: "No-pour area cannot exceed the main slab area." };
  if (draft.noPourDimensions.trim() && !(draft.noPourThickness > 0)) return { error: "Enter the thickness affected by the no-pour area." };
  const mainSlab = totalSquareFeet * draft.thickness / 324;
  const secondaryYardage = secondarySquareFeet * draft.secondaryThickness / 324;
  const insideAdjustment = draft.secondarySectionType === "inside" ? secondarySquareFeet * (draft.secondaryThickness - draft.thickness) / 324 : 0;
  const additionalYardage = draft.secondarySectionType === "additional" ? secondaryYardage : 0;
  const noPourYardage = noPourSquareFeet * draft.noPourThickness / 324;
  const slab = mainSlab + insideAdjustment + additionalYardage - noPourYardage;
  const outerPerimeter = 2 * (primary[0] + primary[1]);
  const footerPerimeter = !draft.keepFooterAroundNoPour && noPour ? Math.max(0, outerPerimeter - noPour[0] - noPour[1]) : outerPerimeter;
  const footerYardage = (footerPerimeter * (footer[0] / 12) * Math.max(footer[1] - draft.thickness, 0) / 12) / 27;
  const total = slab + footerYardage;
  const waste = (total + draft.additionalConcreteYardage) * draft.wastePercent / 100;
  return { slab, footerYardage, total, waste, final: total + draft.additionalConcreteYardage + waste, recommended: Math.ceil(total + draft.additionalConcreteYardage + waste) };
};
const heads = [
  "Status",
  "State",
  "Concrete Company",
  "Client",
  "Dimensions",
  "Thickness",
  "Secondary dimensions",
  "Secondary thickness",
  "Secondary Type",
  "Secondary Area CY",
  "No-Pour Area",
  "No-Pour SF",
  "Net Main SF",
  "Covered Slab SF",
  "Footers",
  "Slab Square Feet",
  "Slab CY",
  "Footer CY",
  "Total CY",
  "Additional Concrete CY",
  "Waste %",
  "Waste CY",
  "Final Order CY",
  "Recommended Order CY",
  "Actions",
];
export function YardagePage({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutate;
}) {
  const [rows, setRows] = useState<YardageRow[]>(data.yardageRows || []),
    [draft, setDraft] = useState<Draft>(blank),
    [editing, setEditing] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [state, setState] = useState("ALL"),
    [sort, setSort] = useState("client");
  const put = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const liveEstimate = useMemo(() => previewYardage(draft), [draft]);
  const active = rows.filter((r) => r.status === "ACTIVE");
  const shown = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            (status === "ALL" || r.status === status) &&
            (state === "ALL" || r.state === state) &&
            `${r.client} ${r.concreteCompany}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => {
          const v = (r: YardageRow) =>
            sort === "total"
              ? r.finalOrderYardage
              : sort === "state"
                    ? r.state
                    : sort === "status"
                      ? r.status
                      : r.client;
          return typeof v(a) === "number"
            ? Number(v(a)) - Number(v(b))
            : String(v(a)).localeCompare(String(v(b)));
        }),
    [rows, search, status, state, sort],
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaveError("");
    try {
      const row = await mutate<YardageRow>(
        editing ? `/api/yardage/${editing}` : "/api/yardage",
        editing ? "PATCH" : "POST",
        draft,
      );
      setRows((old) => editing ? old.map((r) => (r.id === row.id ? row : r)) : [row, ...old]);
      setDraft(blank);
      setEditing(null);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "Unable to save this calculator row."); }
  };
  const edit = (r: YardageRow) => {
    setEditing(r.id);
    setDraft({
      status: r.status,
      state: r.state,
      concreteCompany: r.concreteCompany,
      client: r.client,
      projectId: r.projectId || "",
      dimensions: r.dimensions,
      thickness: r.thickness,
      secondaryDimensions: r.secondaryDimensions || "",
      secondaryThickness: r.secondaryThickness || 0,
      secondarySectionType: r.secondarySectionType || "inside",
      noPourDimensions: r.noPourDimensions || "",
      noPourThickness: r.noPourThickness || 0,
      keepFooterAroundNoPour: r.keepFooterAroundNoPour !== false,
      footers: r.footers,
      additionalConcreteYardage: r.additionalConcreteYardage || 0,
      wastePercent: r.wastePercent || 0,
      notes: r.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const duplicate = async (r: YardageRow) => {
    const copy = await mutate<YardageRow>("/api/yardage", "POST", {
      ...r,
      client: `${r.client} (copy)`,
    });
    setRows((old) => [copy, ...old]);
  };
  const remove = async (r: YardageRow) => {
    if (window.confirm(`Delete ${r.client}?`)) {
      await mutate(`/api/yardage/${r.id}`, "DELETE");
      setRows((old) => old.filter((x) => x.id !== r.id));
    }
  };
  const exportCsv = () => {
    const vals = shown.map((r) => [
      r.status,
      r.state,
      r.concreteCompany,
      r.client,
      r.dimensions,
      r.thickness,
      r.secondaryDimensions,
      r.secondaryThickness,
      r.secondarySectionType,
      r.secondaryAreaYardage,
      r.noPourDimensions,
      r.noPourSquareFeet,
      r.netMainSquareFeet,
      r.totalCoveredSlabSquareFeet,
      r.footers,
      r.slabSquareFeet,
      r.slabYardage,
      r.footerYardage,
      r.totalYardage,
      r.additionalConcreteYardage,
      r.wastePercent,
      r.wasteOverageYardage,
      r.finalOrderYardage,
      r.recommendedOrderYardage,
    ]);
    const csv = [heads.slice(0, -1), ...vals]
      .map((line) =>
        line.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "bullshark-yardage-calculator.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Concrete estimating</p>
          <h1>Yardage Calculator</h1>
          <p>Saved concrete quantities and ready-to-order yardage.</p>
        </div>
        <div className="page-actions">
          <button
            className="button button-small"
            onClick={() => window.print()}
          >
            <Printer size={15} /> Print
          </button>
          <button
            className="button button-small button-dark"
            onClick={exportCsv}
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      </section>
      <section className="metric-grid yardage-metrics">
        <Metric label="Active calculator rows" value={String(active.length)} />
        <Metric label="Final order — active" value={cy(active.reduce((n, r) => n + r.finalOrderYardage, 0))} />
      </section>
      <section className="yardage-panel">
        <div className="panel-title">
          <div>
            <h2>{editing ? "Edit project row" : "Add project row"}</h2>
            <p>
              Yardage is recalculated and validated by the server when saved.
            </p>
          </div>
          {editing && (
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setEditing(null);
                setDraft(blank);
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
        <form className="yardage-form" onSubmit={save}>
          <select
            value={draft.status}
            onChange={(e) => put("status", e.target.value as YardageStatus)}
          >
            {["ACTIVE", "INACTIVE", "POTENTIAL", "COMPLETED"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input
            value={draft.state}
            onChange={(e) => put("state", e.target.value.toUpperCase())}
            placeholder="State"
          />
          <input
            value={draft.concreteCompany}
            onChange={(e) => put("concreteCompany", e.target.value)}
            placeholder="Concrete company"
          />
          <input
            value={draft.client}
            onChange={(e) => put("client", e.target.value)}
            placeholder="Client / project"
            required
          />
          <select
            value={draft.projectId}
            onChange={(e) => put("projectId", e.target.value)}
          >
            <option value="">Connect project (optional)</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={draft.dimensions}
            onChange={(e) => put("dimensions", e.target.value)}
            placeholder="Dimensions: 60x40"
            required
          />
          <Num
            label="Thickness (in)"
            value={draft.thickness}
            set={(v) => put("thickness", v)}
          />
          <label className="currency-input"><span>Secondary dimensions</span><input value={draft.secondaryDimensions} onChange={(e) => put("secondaryDimensions", e.target.value)} placeholder="Second area: 20x10" /></label>
          <Num
            label="Secondary thickness (in)"
            value={draft.secondaryThickness}
            set={(v) => put("secondaryThickness", v)}
          />
          <label className="currency-input"><span>Secondary section type</span><select value={draft.secondarySectionType} onChange={(e) => put("secondarySectionType", e.target.value as Draft["secondarySectionType"])}><option value="inside">Inside main slab</option><option value="additional">Additional attached slab</option></select></label>
          <label className="currency-input"><span>No-pour area</span><input value={draft.noPourDimensions} onChange={(e) => put("noPourDimensions", e.target.value)} placeholder="No-pour: 8x10" /></label>
          <Num label="No-pour thickness affected (in)" value={draft.noPourThickness} set={(v) => put("noPourThickness", v)} />
          <label className="yardage-check"><input type="checkbox" checked={draft.keepFooterAroundNoPour} onChange={(e) => put("keepFooterAroundNoPour", e.target.checked)} /> Keep footer / thickened edge around no-pour</label>
          <input
            value={draft.footers}
            onChange={(e) => put("footers", e.target.value)}
            placeholder="Thickened edge: 12x18"
            required
          />
          <Num
            label="Additional concrete CY"
            value={draft.additionalConcreteYardage}
            set={(v) => put("additionalConcreteYardage", v)}
          />
          <label className="currency-input"><span>Waste / overage</span><select value={[0, 5, 7, 10].includes(draft.wastePercent) ? String(draft.wastePercent) : "custom"} onChange={(e) => { if (e.target.value !== "custom") put("wastePercent", Number(e.target.value)); }}><option value="0">0%</option><option value="5">5%</option><option value="7">7%</option><option value="10">10%</option><option value="custom">Custom</option></select></label>
          <Num label="Custom waste %" value={draft.wastePercent} set={(v) => put("wastePercent", v)} />
          <button className="button button-primary" type="submit">
            <Plus size={15} /> {editing ? "Save row" : "Add row"}
          </button>
          {liveEstimate && ("error" in liveEstimate ? <p className="form-error">{liveEstimate.error}</p> : <p className="yardage-live-estimate">Live estimate: Slab <b>{cy(liveEstimate.slab)}</b> · Thickened edge <b>{cy(liveEstimate.footerYardage)}</b> · Total <b>{cy(liveEstimate.total)}</b> · Waste <b>{cy(liveEstimate.waste)}</b> · Final <b>{cy(liveEstimate.final)}</b> · Recommended <b>{liveEstimate.recommended} CY</b></p>)}
          {saveError && <p className="form-error">{saveError}</p>}
        </form>
        <p className="form-hint">
          Footers are entered as width × total depth. The calculator counts only
          the depth below the main slab, so slab concrete is not double-counted.
          Choose whether a secondary section is inside the main slab or an
          additional attached slab. No-pour areas remove only slab concrete.
        </p>
      </section>
      <section className="yardage-panel">
        <div className="yardage-toolbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or concrete company"
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            {["ACTIVE", "INACTIVE", "POTENTIAL", "COMPLETED"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="ALL">All states</option>
            {Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="client">Sort: Client</option>
            <option value="state">Sort: State</option>
            <option value="total">Sort: Final order</option>
            <option value="status">Sort: Status</option>
          </select>
        </div>
        <div className="table-wrap yardage-table">
          <table>
            <thead>
              <tr>
                {heads.map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`yardage-${r.status.toLowerCase()}`}>
                  <td>
                    <strong>{r.status}</strong>
                  </td>
                  <td>{r.state}</td>
                  <td>{r.concreteCompany}</td>
                  <td>
                    {r.projectId ? (
                      <a
                        className="project-link"
                        href={`#project-${r.projectId}`}
                      >
                        {r.client}
                      </a>
                    ) : (
                      r.client
                    )}
                  </td>
                  <td>{r.dimensions}</td>
                  <td>{r.thickness} in</td>
                  <td>{r.secondaryDimensions || "—"}</td>
                  <td>{r.secondaryThickness ? `${r.secondaryThickness} in` : "—"}</td>
                  <td>{r.secondarySectionType === "additional" ? "Additional" : "Inside"}</td>
                  <td>{cy(r.secondaryAreaYardage)}</td>
                  <td>{r.noPourDimensions || "—"}</td>
                  <td>{r.noPourSquareFeet.toFixed(2)}</td>
                  <td>{r.netMainSquareFeet.toFixed(2)}</td>
                  <td>{r.totalCoveredSlabSquareFeet.toFixed(2)}</td>
                  <td>{r.footers}</td>
                  <td>{r.slabSquareFeet.toFixed(2)}</td>
                  <td>{cy(r.slabYardage)}</td>
                  <td>{cy(r.footerYardage)}</td>
                  <td>{cy(r.totalYardage)}</td>
                  <td>{cy(r.additionalConcreteYardage)}</td>
                  <td>{r.wastePercent.toFixed(2)}%</td>
                  <td>{cy(r.wasteOverageYardage)}</td>
                  <td>
                    <strong>{cy(r.finalOrderYardage)}</strong>
                  </td>
                  <td><strong>{r.recommendedOrderYardage} CY</strong></td>
                  <td className="table-actions">
                    <button
                      className="button button-small"
                      onClick={() => edit(r)}
                    >
                      Edit
                    </button>
                    <button
                      className="button button-small"
                      onClick={() => void duplicate(r)}
                    >
                      Duplicate
                    </button>
                    <button
                      className="icon-button"
                      title="Delete row"
                      onClick={() => void remove(r)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={25} className="empty-cell">
                    No calculator rows match these filters. Add your first
                    project above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong className="metric-text">{value}</strong>
      <small>Active calculator rows</small>
    </article>
  );
}
function Num({
  label,
  value,
  set,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
}) {
  return (
    <label className="currency-input">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => set(Number(e.target.value))}
      />
    </label>
  );
}
