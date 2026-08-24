import { Check, X } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

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
