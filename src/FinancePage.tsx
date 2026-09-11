import { useEffect, useMemo, useState } from "react";
import type { BootstrapPayload, Project, YardageRow } from "./types";

type Mutate = <T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => Promise<T>;
type FinancialValues = Pick<YardageRow, "concreteCost" | "subCost" | "contractCost" | "additionalCosts">;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
const normalized = (value?: string) => (value || "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchingProject(row: YardageRow, projects: Project[]) {
  if (row.projectId) return projects.find((project) => project.id === row.projectId);
  const rowName = normalized(row.client);
  const matches = projects.filter((project) => [project.name, project.clientName, project.clientContactName].some((name) => normalized(name) === rowName));
  return matches.length === 1 ? matches[0] : undefined;
}

export function projectFinancialValues(row: YardageRow, data: BootstrapPayload): FinancialValues & { connected: boolean } {
  const project = matchingProject(row, data.projects);
  if (!project) return { concreteCost: row.concreteCost, subCost: row.subCost, contractCost: row.contractCost, additionalCosts: row.additionalCosts, connected: false };

  const values = (data.projectExpenses || []).filter((expense) => expense.projectId === project.id).reduce<FinancialValues>((sum, expense) => {
    const category = normalized(expense.category);
    if (category.includes("concrete")) sum.concreteCost += expense.amount;
    else if (category.includes("labor") || category.includes("subcontract")) sum.subCost += expense.amount;
    else sum.additionalCosts += expense.amount;
    return sum;
  }, { concreteCost: 0, subCost: 0, contractCost: project.budget, additionalCosts: 0 });

  return { ...values, connected: true };
}

export function FinancePage({ data, mutate }: { data: BootstrapPayload; mutate: Mutate }) {
  const [rows, setRows] = useState(data.yardageRows || []);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<FinancialValues>({ concreteCost: 0, subCost: 0, contractCost: 0, additionalCosts: 0 });
  useEffect(() => setRows(data.yardageRows || []), [data.yardageRows]);
  const financialRows = useMemo(() => rows.map((row) => ({ row, values: projectFinancialValues(row, data) })), [data, rows]);
  const totals = useMemo(() => financialRows.reduce((sum, item) => ({
    contract: sum.contract + item.values.contractCost,
    costs: sum.costs + item.values.concreteCost + item.values.subCost + item.values.additionalCosts,
  }), { contract: 0, costs: 0 }), [financialRows]);
  const beginEdit = (row: YardageRow) => { setEditing(row.id); setDraft({ concreteCost: row.concreteCost, subCost: row.subCost, contractCost: row.contractCost, additionalCosts: row.additionalCosts }); };
  const save = async () => {
    if (!editing) return;
    const saved = await mutate<YardageRow>(`/api/yardage/${editing}`, "PATCH", draft);
    setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
    setEditing(null);
  };
  return <>
    <section className="page-heading"><div><p className="eyebrow">Business planning</p><h1>Financials</h1><p>Track contract value, concrete, subcontractor, and additional costs separately from yardage.</p></div></section>
    <section className="metric-grid"><Metric label="Contract value" value={money(totals.contract)} /><Metric label="Total costs" value={money(totals.costs)} /><Metric label="Estimated profit" value={money(totals.contract - totals.costs)} /></section>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Project financials</h2><p>Connected projects use their contract cost and recorded spending automatically.</p></div></div><div className="table-wrap"><table className="finance-table"><thead><tr><th>Project</th><th>Concrete</th><th>Subcontractor</th><th>Additional</th><th>Contract</th><th>Profit</th><th></th></tr></thead><tbody>{financialRows.map(({ row, values }) => <tr key={row.id}><td><strong>{row.client}</strong><small>{row.state} · {row.concreteCompany || "No supplier"}</small></td>{editing === row.id ? <><MoneyInput value={draft.concreteCost} onChange={(value) => setDraft({ ...draft, concreteCost: value })} /><MoneyInput value={draft.subCost} onChange={(value) => setDraft({ ...draft, subCost: value })} /><MoneyInput value={draft.additionalCosts} onChange={(value) => setDraft({ ...draft, additionalCosts: value })} /><MoneyInput value={draft.contractCost} onChange={(value) => setDraft({ ...draft, contractCost: value })} /><td><strong>{money(draft.contractCost - draft.concreteCost - draft.subCost - draft.additionalCosts)}</strong></td><td><button className="button button-small" onClick={() => void save()}>Save</button><button className="button button-small" onClick={() => setEditing(null)}>Cancel</button></td></> : <><td>{money(values.concreteCost)}</td><td>{money(values.subCost)}</td><td>{money(values.additionalCosts)}</td><td>{money(values.contractCost)}</td><td><strong>{money(values.contractCost - values.concreteCost - values.subCost - values.additionalCosts)}</strong></td><td>{values.connected ? <small>Project data</small> : <button className="button button-small" onClick={() => beginEdit(row)}>Edit</button>}</td></>}</tr>)}{!rows.length && <tr><td colSpan={7} className="empty-cell">Add a calculator row first, then its financial details will appear here.</td></tr>}</tbody></table></div></section>
  </>;
}
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric-card"><span>{label}</span><strong className="metric-text">{value}</strong><small>All calculator projects</small></article>; }
function MoneyInput({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <td><input aria-label="Financial amount" type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></td>; }
