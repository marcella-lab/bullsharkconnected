import { useMemo, useState } from "react";
import type { BootstrapPayload, YardageRow } from "./types";

type Mutate = <T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => Promise<T>;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);

export function FinancePage({ data, mutate }: { data: BootstrapPayload; mutate: Mutate }) {
  const [rows, setRows] = useState(data.yardageRows || []);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ concreteCost: 0, subCost: 0, contractCost: 0, additionalCosts: 0 });
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    contract: sum.contract + row.contractCost,
    costs: sum.costs + row.concreteCost + row.subCost + row.additionalCosts,
  }), { contract: 0, costs: 0 }), [rows]);
  const projectExpenses = data.projectExpenses || [];
  const recordedSpending = useMemo(() => projectExpenses.reduce((sum, expense) => sum + expense.amount, 0), [projectExpenses]);
  const beginEdit = (row: YardageRow) => { setEditing(row.id); setDraft({ concreteCost: row.concreteCost, subCost: row.subCost, contractCost: row.contractCost, additionalCosts: row.additionalCosts }); };
  const save = async () => {
    if (!editing) return;
    const saved = await mutate<YardageRow>(`/api/yardage/${editing}`, "PATCH", draft);
    setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
    setEditing(null);
  };
  return <>
    <section className="page-heading"><div><p className="eyebrow">Business planning</p><h1>Financials</h1><p>Track contract value, concrete, subcontractor, and additional costs separately from yardage.</p></div></section>
    <section className="metric-grid"><Metric label="Contract value" value={money(totals.contract)} /><Metric label="Estimated costs" value={money(totals.costs)} /><Metric label="Estimated profit" value={money(totals.contract - totals.costs)} /><Metric label="Recorded project spending" value={money(recordedSpending)} /></section>
    <section className="panel table-panel"><div className="panel-heading"><div><h2>Project financials</h2><p>Amounts are connected to the matching calculator project.</p></div></div><div className="table-wrap"><table className="finance-table"><thead><tr><th>Project</th><th>Concrete</th><th>Subcontractor</th><th>Additional</th><th>Contract</th><th>Profit</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.client}</strong><small>{row.state} · {row.concreteCompany || "No supplier"}</small></td>{editing === row.id ? <><MoneyInput value={draft.concreteCost} onChange={(value) => setDraft({ ...draft, concreteCost: value })} /><MoneyInput value={draft.subCost} onChange={(value) => setDraft({ ...draft, subCost: value })} /><MoneyInput value={draft.additionalCosts} onChange={(value) => setDraft({ ...draft, additionalCosts: value })} /><MoneyInput value={draft.contractCost} onChange={(value) => setDraft({ ...draft, contractCost: value })} /><td><strong>{money(draft.contractCost - draft.concreteCost - draft.subCost - draft.additionalCosts)}</strong></td><td><button className="button button-small" onClick={() => void save()}>Save</button><button className="button button-small" onClick={() => setEditing(null)}>Cancel</button></td></> : <><td>{money(row.concreteCost)}</td><td>{money(row.subCost)}</td><td>{money(row.additionalCosts)}</td><td>{money(row.contractCost)}</td><td><strong>{money(row.contractCost - row.concreteCost - row.subCost - row.additionalCosts)}</strong></td><td><button className="button button-small" onClick={() => beginEdit(row)}>Edit</button></td></>}</tr>)}{!rows.length && <tr><td colSpan={7} className="empty-cell">Add a calculator row first, then its financial details will appear here.</td></tr>}</tbody></table></div></section>
    <section className="panel"><div className="panel-heading"><div><h2>Project spending</h2><p>Actual expenses recorded from each project.</p></div></div>{data.projects.length ? <div className="compact-list">{data.projects.map((project) => { const expenses = projectExpenses.filter((expense) => expense.projectId === project.id).sort((a, b) => b.spentOn.localeCompare(a.spentOn)); const total = expenses.reduce((sum, expense) => sum + expense.amount, 0); return <article key={project.id}><span><strong>{project.name}</strong><small>{expenses.length} spending record{expenses.length === 1 ? "" : "s"}</small>{expenses.length ? expenses.map((expense) => <small key={expense.id}>{expense.spentOn} · {expense.category}: {expense.description}</small>) : <small>No spending recorded.</small>}</span><strong>{money(total)}</strong></article>; })}</div> : <p className="panel-empty">No projects available.</p>}</section>
  </>;
}
function Metric({ label, value }: { label: string; value: string }) { return <article className="metric-card"><span>{label}</span><strong className="metric-text">{value}</strong><small>All projects</small></article>; }
function MoneyInput({ value, onChange }: { value: number; onChange: (value: number) => void }) { return <td><input aria-label="Financial amount" type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></td>; }
