import { Check, Download, Eye, MoreVertical, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Project, YardageRow } from "./types";

export const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const dateLabel = (value?: string) => {
  if (!value) return "Not scheduled";
  // Date-only values are interpreted at midday to avoid time-zone shifts;
  // ISO timestamps (such as a user's last login) are parsed as-is.
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? "Never"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress-track" aria-label={`${value}% complete`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function YardageReferenceSheet({ project, rows }: { project: Project; rows: YardageRow[] }) {
  const row = rows.find((item) => item.projectId === project.id);
  if (!row) return null;
  return <section className="yardage-reference"><strong>Concrete reference sheet</strong><div><span>State <b>{row.state || "—"}</b></span><span>Supplier <b>{row.concreteCompany || "—"}</b></span><span>Dimensions <b>{row.dimensions}</b></span><span>Thickness <b>{row.thickness} in</b></span><span>Footers <b>{row.footers}</b></span><span>Slab sq. ft. <b>{row.slabSquareFeet.toFixed(0)}</b></span><span>Slab CY <b>{row.slabYardage.toFixed(2)}</b></span><span>Footer CY <b>{row.footerYardage.toFixed(2)}</b></span><span>Total CY <b>{row.totalYardage.toFixed(2)}</b></span><span>Additional CY <b>{row.additionalConcreteYardage.toFixed(2)}</b></span><span>Waste / overage <b>{row.wasteOverageYardage.toFixed(2)}</b></span><span className="yardage-final">Final order <b>{row.finalOrderYardage.toFixed(2)} CY</b></span></div></section>;
}

export function StatusPill({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "cyan" | "green" | "orange" | "red" }>) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Check size={20} /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export type ActionMenuItem = { label: string; onSelect: () => void; destructive?: boolean; dividerBefore?: boolean; icon?: ReactNode };
const actionIcon = (label: string, destructive?: boolean) => {
  const value = label.toLowerCase();
  if (destructive || value.includes("delete") || value.includes("remove")) return <Trash2 size={16}/>;
  if (value.includes("add") || value.includes("create")) return <Plus size={16}/>;
  if (value.includes("edit") || value.includes("rename")) return <Pencil size={16}/>;
  if (value.includes("preview") || value.includes("view") || value.includes("open")) return <Eye size={16}/>;
  if (value.includes("download")) return <Download size={16}/>;
  if (value.includes("complete") || value.includes("reopen") || value.includes("update")) return value.includes("complete") ? <Check size={16}/> : <RotateCcw size={16}/>;
  return <MoreVertical size={16}/>;
};

export function ActionMenu({ items, label = "More actions", className = "" }: { items: ActionMenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; opensUp: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const toggle = () => {
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const opensUp = window.innerHeight - rect.bottom < 280;
      setMenuPosition({ left: Math.max(12, rect.right - 210), top: opensUp ? rect.top - 6 : rect.bottom + 6, opensUp });
    }
    setOpen((value) => !value);
  };
  const popover = open && menuPosition ? createPortal(<div ref={menuRef} className="action-menu-popover action-menu-portal" role="menu" style={{ left: menuPosition.left, top: menuPosition.top, transform: menuPosition.opensUp ? "translateY(-100%)" : undefined }}>{items.map((item, index) => <div key={`${item.label}-${index}`}>{item.dividerBefore && <hr/>}<button type="button" role="menuitem" className={item.destructive ? "action-menu-item action-menu-danger" : "action-menu-item"} onClick={() => { setOpen(false); item.onSelect(); }}>{item.icon || actionIcon(item.label, item.destructive)}<span>{item.label}</span></button></div>)}</div>, document.body) : null;
  return <div ref={ref} className={`action-menu ${open ? "is-open" : ""} ${className}`}><button type="button" className="action-menu-button" aria-label={label} title="More actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><MoreVertical size={21}/></button>{popover}</div>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: PropsWithChildren<{ title: string; eyebrow?: string; onClose: () => void; wide?: boolean }>) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function Field({ label, children, hint }: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function PageHeading({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function SubmitButton({ busy, children }: PropsWithChildren<{ busy?: boolean }>) {
  return <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Saving…" : children}</button>;
}
