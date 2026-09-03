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
  | "footers"
  | "additionalConcreteYardage"
  | "wasteOverageYardage"
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
  footers: "",
  additionalConcreteYardage: 0,
  wasteOverageYardage: 0,
  notes: "",
};
const cy = (n: number) => `${(n || 0).toFixed(2)} CY`;
const heads = [
  "Status",
  "State",
  "Concrete Company",
  "Client",
  "Dimensions",
  "Thickness",
  "Footers",
  "Slab Square Feet",
  "Slab CY",
  "Footer CY",
  "Total CY",
  "Additional Concrete CY",
  "Waste/Overage CY",
  "Final Order CY",
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
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("ALL"),
    [state, setState] = useState("ALL"),
    [sort, setSort] = useState("client");
  const put = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
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
    const row = await mutate<YardageRow>(
      editing ? `/api/yardage/${editing}` : "/api/yardage",
      editing ? "PATCH" : "POST",
      draft,
    );
    setRows((old) =>
      editing ? old.map((r) => (r.id === row.id ? row : r)) : [row, ...old],
    );
    setDraft(blank);
    setEditing(null);
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
      footers: r.footers,
      additionalConcreteYardage: r.additionalConcreteYardage || 0,
      wasteOverageYardage: r.wasteOverageYardage || 0,
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
      r.footers,
      r.slabSquareFeet,
      r.slabYardage,
      r.footerYardage,
      r.totalYardage,
      r.additionalConcreteYardage,
      r.wasteOverageYardage,
      r.finalOrderYardage,
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
          <input
            value={draft.footers}
            onChange={(e) => put("footers", e.target.value)}
            placeholder="Footers: 18x24"
            required
          />
          <Num
            label="Additional concrete CY"
            value={draft.additionalConcreteYardage}
            set={(v) => put("additionalConcreteYardage", v)}
          />
          <Num
            label="Waste / overage CY"
            value={draft.wasteOverageYardage}
            set={(v) => put("wasteOverageYardage", v)}
          />
          <button className="button button-primary" type="submit">
            <Plus size={15} /> {editing ? "Save row" : "Add row"}
          </button>
        </form>
        <p className="form-hint">
          Slab CY = Length × Width × Thickness ÷ 324. Final Order CY adds
          additional concrete and waste/overage to Total CY.
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
                  <td>{r.footers}</td>
                  <td>{r.slabSquareFeet.toFixed(2)}</td>
                  <td>{cy(r.slabYardage)}</td>
                  <td>{cy(r.footerYardage)}</td>
                  <td>{cy(r.totalYardage)}</td>
                  <td>{cy(r.additionalConcreteYardage)}</td>
                  <td>{cy(r.wasteOverageYardage)}</td>
                  <td>
                    <strong>{cy(r.finalOrderYardage)}</strong>
                  </td>
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
                  <td colSpan={15} className="empty-cell">
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
