import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ActionMenu, Modal, SubmitButton } from "./components";
import { api } from "./api";
import type { BootstrapPayload, ConcreteSupplier } from "./types";

const blank = { company: "", supplierType: "", contactName: "", phone: "", email: "", state: "", notes: "" };
export function SuppliersPage({ data }: { data: BootstrapPayload }) {
  const [suppliers, setSuppliers] = useState<ConcreteSupplier[]>(data.concreteSuppliers || []);
  const [assigning, setAssigning] = useState<ConcreteSupplier | null>(null);
  const [projects, setProjects] = useState(data.projects);
  useEffect(() => setProjects(data.projects), [data.projects]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => setSuppliers(data.concreteSuppliers || []), [data.concreteSuppliers]);
  const [draft, setDraft] = useState(blank); const [search, setSearch] = useState("");
  const shown = useMemo(() => suppliers.filter((supplier) => `${supplier.company} ${supplier.supplierType || ""} ${supplier.state || ""}`.toLowerCase().includes(search.toLowerCase())), [search, suppliers]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const saved = await api.mutate<ConcreteSupplier>(editing ? `/api/yardage/suppliers/${editing}` : "/api/yardage/suppliers", "admin", editing ? "PATCH" : "POST", draft);
      setSuppliers((current) => [saved, ...current.filter((item) => item.id !== saved.id)]); setDraft(blank); setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save supplier."); } finally { setBusy(false); }
  };
  const remove = async (supplier: ConcreteSupplier) => {
    if (!window.confirm(`Delete ${supplier.company}? This also removes its project and job assignments. Saved concrete sheet details will be retained.`)) return;
    setError("");
    try { await api.mutate(`/api/yardage/suppliers/${supplier.id}`, "admin", "DELETE"); setSuppliers((current) => current.filter((item) => item.id !== supplier.id)); if (editing === supplier.id) { setEditing(null); setDraft(blank); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete supplier."); }
  };
  const assign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!assigning) return; setBusy(true); setError("");
    const supplierId = assigning.id; const projectIds = new FormData(event.currentTarget).getAll("projectIds").map(String);
    try {
      await api.mutate(`/api/yardage/suppliers/${supplierId}/projects`, "admin", "PATCH", { projectIds });
      setProjects((current) => current.map((project) => ({ ...project, supplierIds: [...(project.supplierIds || []).filter((id) => id !== supplierId), ...(projectIds.includes(project.id) ? [supplierId] : [])] })));
      setAssigning(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to assign supplier."); }
    finally { setBusy(false); }
  };
  return <><section className="page-heading"><div><p className="eyebrow">Company directory</p><h1>Suppliers</h1><p>Save concrete suppliers and other vendor contacts in one place.</p></div></section><section className="panel"><div className="panel-heading"><div><h2>{editing ? "Edit supplier" : "Add supplier"}</h2><p>This directory is separate from the Yardage Calculator.</p></div></div><form className="supplier-form" onSubmit={save}><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} placeholder="Supplier company" required /><input value={draft.supplierType} onChange={(event) => setDraft({ ...draft, supplierType: event.target.value })} placeholder="Supplier type" /><input value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} placeholder="Contact name" /><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="Phone" /><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="Email" /><input value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value.toUpperCase() })} placeholder="State" /><input aria-label="Supplier notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Notes" /><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save supplier"}</button>{editing && <button type="button" className="button button-ghost" onClick={() => { setEditing(null); setDraft(blank); setError(""); }}>Cancel</button>}{error && <p role="alert" className="form-error">{error}</p>}</form></section><section className="panel"><div className="panel-heading"><div><h2>Supplier directory</h2><p>{suppliers.length} supplier{suppliers.length === 1 ? "" : "s"} saved.</p></div></div><div className="supplier-filter"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppliers" /></div><div className="supplier-list">{shown.map((supplier) => <div key={supplier.id} style={{ position: "relative", paddingRight: 48 }}><strong>{supplier.company}</strong><ActionMenu className="supplier-actions" label={`Actions for ${supplier.company}`} items={[{ label: "Edit", onSelect: () => { setEditing(supplier.id); setDraft({ ...blank, ...Object.fromEntries(Object.keys(blank).map((key) => [key, supplier[key as keyof ConcreteSupplier] || ""])) }); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); } }, { label: "Assign to project", onSelect: () => { setAssigning(supplier); setError(""); } }, { label: "Delete", destructive: true, onSelect: () => void remove(supplier) }]} /><span className="supplier-tags">{supplier.state && <b>{supplier.state}</b>}{supplier.supplierType && <b>{supplier.supplierType}</b>}</span><span>{[supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(" · ") || "No contact details"}</span>{supplier.notes && <p>{supplier.notes}</p>}<small>Projects: {projects.filter((project) => project.supplierIds?.includes(supplier.id)).map((project) => project.name).join(", ") || "Not assigned"}</small></div>)}{!shown.length && <p className="empty-cell">No suppliers match this search.</p>}</div></section>{assigning && <Modal title={`Assign ${assigning.company} to projects`} onClose={() => setAssigning(null)}><form onSubmit={(event) => void assign(event)}><fieldset disabled={busy}><legend>Select projects</legend><p>Select multiple projects, or uncheck a project to remove this supplier.</p>{projects.map((project) => <label key={project.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBlock: 12 }}><input style={{ width: "auto" }} type="checkbox" name="projectIds" value={project.id} defaultChecked={project.supplierIds?.includes(assigning.id) || false}/>{project.number} · {project.name}</label>)}{!projects.length && <p>No projects available.</p>}<div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setAssigning(null)}>Cancel</button><SubmitButton busy={busy}>Save assignments</SubmitButton></div></fieldset>{error && <p role="alert" className="form-error">{error}</p>}</form></Modal>}</>;
}
