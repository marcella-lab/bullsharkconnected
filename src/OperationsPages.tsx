import {
  Bell,
  FileText,
  FileUp,
  ReceiptText,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import {
  currency,
  ActionMenu,
  dateLabel,
  EmptyState,
  Field,
  Modal,
  PageHeading,
  StatusPill,
  SubmitButton,
} from "./components";
import type {
  BootstrapPayload,
  ClientInvoice,
  FileVisibility,
  PayRequest,
  PortalFile,
  PortalUser,
  Project,
  Role,
} from "./types";
import type { Mutation } from "./AdminPages";

const payTone = (status: string) =>
  status === "paid" || status === "approved"
    ? "green"
    : status === "rejected"
      ? "red"
      : status === "needs_revision"
        ? "orange"
        : "cyan";

export function AdminUsers({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutation;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<PortalUser[] | null>(data.users || []);
  const [loadError, setLoadError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const load = () =>
    void api
      .get<PortalUser[]>("/api/users", "admin")
      .then((next) => {
        setUsers(next);
        setLoadError("");
      })
      .catch((error) => {
        setUsers((current) => current || data.users || []);
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to refresh User Management.",
        );
      });
  useEffect(load, []);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get("firstName"));
    const lastName = String(form.get("lastName"));
    setBusy(true);
    try {
      const result = await mutate<{ invitationEmailSent?: boolean; invitationEmailNotice?: string }>("/api/users", "POST", {
        role: form.get("role"),
        name: `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        email: form.get("email"),
        phone: form.get("phone"),
        company: form.get("company"),
        trade: form.get("trade"),
        projectIds: form.getAll("projectIds"),
        jobIds: form.getAll("jobIds"),
      });
      setOpen(false);
      setAccountNotice(result.invitationEmailSent ? "User created and invitation email sent." : `User created. ${result.invitationEmailNotice || "Invitation email could not be sent."}`);
      load();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="Admin-only access control"
        title="User management"
        detail="Create unlimited Client, Subcontractor, Project Manager, and Admin accounts. New accounts receive a one-time temporary password and must change it at first login."
        actions={
          <button
            className="button button-primary"
            onClick={() => setOpen(true)}
          >
            <UserPlus size={16} /> Add user
          </button>
        }
      />
      {accountNotice && <p className={accountNotice.includes("email sent") ? "form-success" : "form-error"}>{accountNotice}</p>}
      {!users && !loadError && (
        <section className="panel">
          <p>Loading User Management…</p>
        </section>
      )}
      {loadError && (
        <section className="panel">
          <h2>We couldn’t load User Management.</h2>
          <p>{loadError}</p>
          <button
            className="button button-primary"
            onClick={() => {
              setLoadError("");
              load();
            }}
          >
            Try again
          </button>
        </section>
      )}
      {users && (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Trade</th>
                  <th>Role</th>
                  <th>Assigned projects / jobs</th>
                  <th>Account status</th>
                  <th>Last login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                    </td>
                    <td>{user.company || "—"}</td>
                    <td>{user.email}</td>
                    <td>{user.phone || "—"}</td>
                    <td>{user.trade || "—"}</td>
                    <td>
                      <StatusPill tone="cyan">{user.role}</StatusPill>
                    </td>
                    <td>
                      {user.role === "admin" || user.role === "project_manager"
                        ? "Full access"
                        : `${user.projectIds.length} project(s) · ${user.jobIds.length} job(s)`}
                    </td>
                    <td>
                      <StatusPill tone={user.active ? "green" : "red"}>
                        {user.active ? "Active" : "Disabled"}
                      </StatusPill>
                    </td>
                    <td>
                      {user.lastLoginAt ? dateLabel(user.lastLoginAt) : "Never"}
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => void mutate<{ invitationEmailSent?: boolean; invitationEmailNotice?: string }>(`/api/users/${user.id}/reset-password`, "POST").then((result) => setAccountNotice(result.invitationEmailSent ? `Password reset email sent to ${user.email}.` : `Password reset for ${user.email}. ${result.invitationEmailNotice || "Email could not be sent."}`)).catch((error) => setAccountNotice(error instanceof Error ? error.message : "Unable to reset password."))}
                      >
                        Reset password
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          void mutate(`/api/users/${user.id}`, "PATCH", {
                            active: !user.active,
                          }).then(load)
                        }
                      >
                        {user.active ? "Deactivate" : "Reactivate"}
                      </button>
                      <button
                        className="text-button action-danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${user.name}'s login account? This cannot be undone.`,
                            )
                          )
                            void mutate(`/api/users/${user.id}`, "DELETE").then(
                              load,
                            );
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!users.length && (
            <EmptyState
              title="No users have been created yet."
              detail="Create the first account to grant portal access."
            />
          )}
        </section>
      )}
      {open && (
        <Modal
          title="Add user"
          eyebrow="Temporary password: SteelCool123"
          onClose={() => setOpen(false)}
          wide
        >
          <form className="form-grid" onSubmit={submit}>
            <Field label="First name">
              <input name="firstName" required />
            </Field>
            <Field label="Last name">
              <input name="lastName" required />
            </Field>
            <Field label="Company name">
              <input name="company" />
            </Field>
            <Field label="Email / login">
              <input name="email" type="email" required />
            </Field>
            <Field label="Phone number">
              <input name="phone" />
            </Field>
            <Field label="Trade">
              <input name="trade" />
            </Field>
            <Field label="User access / role">
              <select name="role">
                <option value="client">Client</option>
                <option value="subcontractor">Subcontractor</option>
                <option value="project_manager">
                  Project Manager (read-only)
                </option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Project access">
              <div className="checkbox-list">
                {data.projects.map((project) => (
                  <label key={project.id}><input name="projectIds" type="checkbox" value={project.id} /> {project.name}</label>
                ))}
              </div>
            </Field>
            <Field label="Job / scope access">
              <div className="checkbox-list">
                {data.jobs.map((job) => (
                  <label key={job.id}><input name="jobIds" type="checkbox" value={job.id} /> {job.title}</label>
                ))}
              </div>
            </Field>
            <div className="form-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <SubmitButton busy={busy}>Create user</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdminPayRequests({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutation;
}) {
  const [selected, setSelected] = useState<PayRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const requests = data.payRequests || [];
  const openRequestFile = (request: PayRequest, fileId: string) => {
    setFileError("");
    void api.openPayRequestFile(request.id, fileId, data.viewer.role).catch((error) => setFileError(error instanceof Error ? error.message : "Unable to open the invoice file."));
  };
  const update = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await mutate(`/api/pay-requests/${selected.id}`, "PATCH", {
        status: f.get("status"),
        approvedAmount: f.get("approvedAmount") || undefined,
        adminNotes: f.get("adminNotes"),
        paymentDate: f.get("paymentDate") || undefined,
        paymentReference: f.get("paymentReference"),
      });
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="Payment workflow"
        title={`Invoices / pay requests${requests.filter((item) => !item.readByAdmin).length ? ` (${requests.filter((item) => !item.readByAdmin).length})` : ""}`}
        detail="Review invoice-backed requests, record decisions, and retain a complete activity trail."
      />
      <section className="panel admin-table-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Subcontractor</th>
                <th>Project / job</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.invoiceNumber}</strong>
                    <small>{dateLabel(item.invoiceDate)}</small>
                  </td>
                  <td>{item.company || item.subcontractorName}</td>
                  <td>
                    {
                      data.projects.find(
                        (project) => project.id === item.projectId,
                      )?.name
                    }
                    <small>
                      {data.jobs.find((job) => job.id === item.jobId)?.title}
                    </small>
                  </td>
                  <td>{currency.format(item.amountRequested)}</td>
                  <td>
                    <StatusPill tone={payTone(item.status)}>
                      {item.status.replaceAll("_", " ")}
                    </StatusPill>
                  </td>
                  <td className="table-actions">
                    <button
                      className="button button-small"
                      onClick={() => setSelected(item)}
                    >
                      Review
                    </button>
                    <button
                      className="button button-small button-paid"
                      onClick={() =>
                        void mutate(`/api/pay-requests/${item.id}`, "PATCH", {
                          status: "paid",
                          approvedAmount:
                            item.approvedAmount || item.amountRequested,
                          paymentDate: new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      Paid
                    </button>
                    <button
                      className="button button-small button-denied"
                      onClick={() =>
                        void mutate(`/api/pay-requests/${item.id}`, "PATCH", {
                          status: "rejected",
                        })
                      }
                    >
                      Denied
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!requests.length && (
          <EmptyState
            title="No pay requests"
            detail="Invoice-backed subcontractor requests will arrive here."
          />
        )}
      </section>
      {selected && (
        <Modal
          title={`Review ${selected.invoiceNumber}`}
          eyebrow={selected.company}
          onClose={() => setSelected(null)}
        >
          <form className="form-grid" onSubmit={update}>
            <div className="callout">
              <ReceiptText />
              <span>
                <strong>
                  {currency.format(selected.amountRequested)} requested
                </strong>
                <small>
                  {selected.description || "No description provided"}
                </small>
              </span>
            </div>
            <Field label="Invoice file">
              <button className="button button-secondary" type="button" onClick={() => openRequestFile(selected, selected.invoice.id)}>Open {selected.invoice.name}</button>
            </Field>
            {selected.attachments.length > 0 && <Field label="Supporting files"><div className="file-chip-list">{selected.attachments.map((file) => <button className="file-chip" type="button" key={file.id} onClick={() => openRequestFile(selected, file.id)}>Open {file.name}</button>)}</div></Field>}
            {fileError && <p className="form-error" role="alert">{fileError}</p>}
            <Field label="Status">
              <select name="status" defaultValue={selected.status}>
                {[
                  "under_review",
                  "approved",
                  "partially_approved",
                  "payment_processing",
                  "paid",
                  "rejected",
                  "needs_revision",
                ].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Approved amount">
              <input
                name="approvedAmount"
                type="number"
                min="0"
                defaultValue={selected.approvedAmount}
              />
            </Field>
            <Field label="Payment date">
              <input
                name="paymentDate"
                type="date"
                defaultValue={selected.paymentDate}
              />
            </Field>
            <Field label="Check / reference number">
              <input
                name="paymentReference"
                defaultValue={selected.paymentReference}
              />
            </Field>
            <Field label="Admin notes">
              <textarea
                name="adminNotes"
                rows={4}
                defaultValue={selected.adminNotes}
              />
            </Field>
            <div className="form-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <SubmitButton busy={busy}>Save decision</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdminInvoices({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutation;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientInvoice | null>(null);
  const [preview, setPreview] = useState<ClientInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  const invoices = data.clientInvoices || [];
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const saved = await mutate<ClientInvoice>(editing ? `/api/client-invoices/${editing.id}` : "/api/client-invoices", editing ? "PATCH" : "POST", {
        projectId: form.get("projectId"),
        clientId: form.get("clientId"),
        invoiceNumber: form.get("invoiceNumber"),
        invoiceDate: form.get("invoiceDate"),
        dueDate: form.get("dueDate"),
        amount: form.get("amount"),
        description: form.get("description"),
        status: form.get("status"),
      });
      setPreview(saved);
      setOpen(false);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (invoice: ClientInvoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoiceNumber}?`)) return;
    await mutate(`/api/client-invoices/${invoice.id}`, "DELETE");
    setPreview(null);
  };
  const clientFor = (invoice: ClientInvoice) => data.clients.find((client) => client.id === invoice.clientId);
  const projectFor = (invoice: ClientInvoice) => data.projects.find((project) => project.id === invoice.projectId);
  return (
    <>
      <AdminPayRequests data={data} mutate={mutate} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Client invoices</h2>
            <p>
              Admin-created billing records. Client visibility can be enabled
              later without changing pay requests.
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => { setEditing(null); setOpen(true); }}
          >
            Create client invoice
          </button>
        </div>
        {invoices.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.invoiceNumber}</td>
                    <td>
                      {
                        data.clients.find(
                          (client) => client.id === invoice.clientId,
                        )?.name
                      }
                    </td>
                    <td>
                      {
                        data.projects.find(
                          (project) => project.id === invoice.projectId,
                        )?.name
                      }
                    </td>
                    <td>{currency.format(invoice.amount)}</td>
                    <td>
                      <StatusPill tone="cyan">{invoice.status}</StatusPill>
                    </td>
                    <td className="table-actions"><button className="button button-small button-ghost" onClick={() => setPreview(invoice)}>Open</button><button className="button button-small button-ghost" onClick={() => { setPreview(null); setEditing(invoice); setOpen(true); }}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No client invoices"
            detail="Create one when client billing is needed."
          />
        )}
      </section>
      {open && (
        <Modal title={editing ? "Edit client invoice" : "Create client invoice"} onClose={() => { setOpen(false); setEditing(null); }}>
          <form className="form-grid" onSubmit={submit}>
            <Field label="Project">
              <select name="projectId" required defaultValue={editing?.projectId}>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <select name="clientId" required defaultValue={editing?.clientId}>
                {data.clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Invoice number">
              <input name="invoiceNumber" required defaultValue={editing?.invoiceNumber} />
            </Field>
            <Field label="Invoice date">
              <input
                name="invoiceDate"
                type="date"
                required
                defaultValue={editing?.invoiceDate || new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="Due date">
              <input name="dueDate" type="date" defaultValue={editing?.dueDate} />
            </Field>
            <Field label="Amount">
              <input
                name="amount"
                type="number"
                min=".01"
                step=".01"
                required
                defaultValue={editing?.amount}
              />
            </Field>
            <Field label="Status">
              <select name="status" defaultValue={editing?.status || "draft"}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="paid">Paid</option>
                <option value="void">Void</option>
              </select>
            </Field>
            <Field label="Description">
              <textarea name="description" rows={4} defaultValue={editing?.description} />
            </Field>
            <div className="form-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => { setOpen(false); setEditing(null); }}
              >
                Cancel
              </button>
              <SubmitButton busy={busy}>{editing ? "Save invoice" : "Create invoice"}</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
      {preview && <Modal title={`Invoice ${preview.invoiceNumber}`} onClose={() => setPreview(null)}><article className="client-invoice-document"><header className="invoice-document-header"><div><p className="invoice-document-type">INVOICE</p><h2>Bullshark Contracting</h2><p>Construction project billing</p></div><img src="/bullshark-logo.png" alt="Bullshark Contracting logo"/></header><section className="invoice-bill-to"><div><strong>Bill to</strong><span>{clientFor(preview)?.name || "Client"}</span><span>{clientFor(preview)?.company || projectFor(preview)?.name}</span><span>{clientFor(preview)?.email}</span></div><div><strong>Invoice details</strong><span>Invoice no. {preview.invoiceNumber}</span><span>Invoice date {dateLabel(preview.invoiceDate)}</span><span>Due date {preview.dueDate ? dateLabel(preview.dueDate) : "On receipt"}</span></div></section><section className="invoice-line-items"><div className="invoice-line-head"><span>Project / service</span><span>Description</span><span>Amount</span></div><div className="invoice-line"><strong>{projectFor(preview)?.name || "Project"}</strong><span>{preview.description || "Construction services"}</span><strong>{currency.format(preview.amount)}</strong></div><div className="invoice-total"><span>Total due</span><strong>{currency.format(preview.amount)}</strong></div></section><footer><p>Thank you for choosing Bullshark Contracting.</p><StatusPill tone="cyan">{preview.status}</StatusPill></footer></article><div className="form-actions invoice-document-actions"><button className="button button-ghost" onClick={() => { setPreview(null); setEditing(preview); setOpen(true); }}>Edit invoice</button><button className="button button-danger" onClick={() => void remove(preview)}>Delete invoice</button><button className="button button-primary" onClick={() => window.print()}>Print / save PDF</button></div></Modal>}
    </>
  );
}

async function encode(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
export function SubPayRequests({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutation;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const assignedJobIds = new Set(
    data.users?.find((user) => user.id === data.viewer.id)?.jobIds || [],
  );
  const jobs = data.jobs
    .filter((job) => assignedJobIds.has(job.id))
    .sort((a, b) => (a.scheduleStart || "9999-12-31").localeCompare(b.scheduleStart || "9999-12-31"));
  const openInvoice = (request: PayRequest) => {
    setFileError("");
    void api.openPayRequestFile(request.id, request.invoice.id, "subcontractor").catch((error) => setFileError(error instanceof Error ? error.message : "Unable to open the invoice file."));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFileError("");
    const f = new FormData(event.currentTarget);
    const invoice = f.get("invoice") as File;
    const job = data.jobs.find((item) => item.id === f.get("jobId"));
    if (!job || !assignedJobIds.has(job.id)) {
      setFileError("Choose one of your assigned jobs before submitting.");
      return;
    }
    if (!invoice?.size) {
      setFileError("Choose an invoice file before submitting your request.");
      return;
    }
    setBusy(true);
    try {
      await mutate("/api/pay-requests", "POST", {
        projectId: job.projectId,
        jobId: job.id,
        amountRequested: f.get("amountRequested"),
        invoiceNumber: f.get("invoiceNumber"),
        invoiceDate: f.get("invoiceDate"),
        description: f.get("description"),
        invoice: {
          name: invoice.name,
          mimeType: invoice.type,
          contentBase64: await encode(invoice),
        },
        attachments: [],
      });
      setOpen(false);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Unable to submit the pay request. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="Invoice-backed requests"
        title="Pay requests"
        detail="Submit payment requests only for your assigned jobs. An invoice upload is required."
        actions={
          <button
            className="button button-primary"
            onClick={() => setOpen(true)}
          >
            <ReceiptText size={16} /> Create invoice / pay request
          </button>
        }
      />
      <div className="assigned-grid">
        {(data.payRequests || []).map((item) => (
          <article className="assigned-card" key={item.id}>
            <header>
              <StatusPill tone={payTone(item.status)}>
                {item.status.replaceAll("_", " ")}
              </StatusPill>
              <span>{item.invoiceNumber}</span>
            </header>
            <h2>{currency.format(item.amountRequested)}</h2>
            <p>{data.jobs.find((job) => job.id === item.jobId)?.title}</p>
            <div className="assigned-facts">
              <span>
                <small>Submitted</small>
                <strong>{dateLabel(item.createdAt)}</strong>
              </span>
              <span>
                <small>Approved</small>
                <strong>
                  {item.approvedAmount
                    ? currency.format(item.approvedAmount)
                    : "—"}
                </strong>
              </span>
            </div>
            {item.adminNotes && (
              <p>
                <strong>Admin notes:</strong> {item.adminNotes}
              </p>
            )}
            <button className="button button-secondary button-full" type="button" onClick={() => openInvoice(item)}>Open {item.invoice.name}</button>
          </article>
        ))}
      </div>
      {fileError && <p className="form-error" role="alert">{fileError}</p>}
      {open && (
        <Modal
          title="Submit pay request"
          eyebrow="Invoice upload required"
          onClose={() => setOpen(false)}
        >
          <form className="form-grid" onSubmit={submit}>
            <Field label="Assigned job / scope">
              <select name="jobId" required>
                <option value="">Select job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}{job.location ? ` — ${job.location}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount requested">
              <input
                name="amountRequested"
                type="number"
                min=".01"
                step=".01"
                required
              />
            </Field>
            <Field label="Invoice number">
              <input name="invoiceNumber" required />
            </Field>
            <Field label="Invoice date">
              <input name="invoiceDate" type="date" required />
            </Field>
            <Field label="Invoice file (PDF, image, Word, Excel)">
              <input
                name="invoice"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                required
              />
            </Field>
            <Field label="Notes">
              <textarea name="description" rows={4} />
            </Field>
            {fileError && <p className="form-error" style={{ gridColumn: "1 / -1" }} role="alert">{fileError}</p>}
            <div className="form-actions">
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <SubmitButton busy={busy}>Submit request</SubmitButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function NotificationsPage({
  data,
  mutate,
}: {
  data: BootstrapPayload;
  mutate: Mutation;
}) {
  const notices = data.notifications || [];
  return (
    <>
      <PageHeading
        eyebrow="Activity inbox"
        title="Notifications"
        detail="Unread notifications remain here until you mark them read."
        actions={
          <button
            className="button button-secondary"
            onClick={() =>
              void mutate("/api/notifications/read", "POST", { all: true })
            }
          >
            Mark all read
          </button>
        }
      />
      <section className="panel">
        <div className="compact-list">
          {notices.map((notice) => (
            <article key={notice.id}>
              <span className="mini-icon">
                <Bell />
              </span>
              <span>
                <strong>{notice.title}</strong>
                <small>{notice.detail}</small>
              </span>
              {!notice.readAt && (
                <button
                  className="button button-small"
                  onClick={() =>
                    void mutate("/api/notifications/read", "POST", {
                      ids: [notice.id],
                    })
                  }
                >
                  Mark read
                </button>
              )}
            </article>
          ))}
        </div>
        {!notices.length && (
          <EmptyState
            title="All caught up"
            detail="Important project activity will appear here."
          />
        )}
      </section>
    </>
  );
}

export function ProjectFilesModal({
  data,
  project,
  role,
  onClose,
  blueprintMode = false,
}: {
  data: BootstrapPayload;
  project: Project;
  role: Role;
  onClose: () => void;
  blueprintMode?: boolean;
}) {
  const [files, setFiles] = useState(
    (data.files || []).filter(
      (file) =>
        file.projectId === project.id &&
        (!blueprintMode || file.category === "Plans"),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [gps, setGps] = useState<{ lat?: number; lng?: number }>({});
  const [preview, setPreview] = useState<{ name: string; url: string; mimeType: string } | null>(
    null,
  );
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [unavailablePhotos, setUnavailablePhotos] = useState<
    Record<string, true>
  >({});
  const [editing, setEditing] = useState<PortalFile | null>(null);
  const [uploadAudience, setUploadAudience] = useState<FileVisibility>(
    role === "admin" ? "client" : role === "client" ? "client" : "assigned_subcontractor",
  );
  const [editAudience, setEditAudience] = useState<FileVisibility>("admin");
  useEffect(() => {
    setFiles((data.files || []).filter((file) => file.projectId === project.id && (!blueprintMode || file.category === "Plans")));
  }, [blueprintMode, data.files, project.id]);
  const beginEdit = (file: PortalFile) => {
    setEditing(file);
    setEditAudience(
      file.visibility,
    );
  };
  const useLocation = () =>
    navigator.geolocation?.getCurrentPosition(
      (position) =>
        setGps({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      () => setGps({}),
    );
  const openPreview = async (file: (typeof files)[number]) => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ name: file.name, mimeType: file.mimeType, url: await api.previewFile(file.id, role) });
  };
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const images = files.filter((file) => file.mimeType.startsWith("image/"));
    void Promise.allSettled(
      images.map(async (file) => {
        const url = await api.previewFile(file.id, role);
        urls.push(url);
        return [file.id, url] as const;
      }),
    ).then((results) => {
      if (cancelled) {
        urls.forEach(URL.revokeObjectURL);
        return;
      }
      setThumbnails(
        Object.fromEntries(
          results
            .filter(
              (
                result,
              ): result is PromiseFulfilledResult<readonly [string, string]> =>
                result.status === "fulfilled",
            )
            .map((result) => result.value),
        ),
      );
      setUnavailablePhotos(
        Object.fromEntries(
          images
            .filter((_file, index) => results[index]?.status === "rejected")
            .map((file) => [file.id, true]),
        ),
      );
    });
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [files, role]);
  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selected = form
      .getAll("files")
      .filter(
        (value): value is File => value instanceof File && value.size > 0,
      );
    if (!selected.length) return;
    setBusy(true);
    setUploadError("");
    try {
      const jobIds = role === "subcontractor"
          ? data.jobs
              .filter(
                (job) =>
                  job.projectId === project.id &&
                  job.contractorId === data.viewer.id,
              )
              .map((job) => job.id)
          : [];
      const saved = await Promise.all(
        selected.map(async (file) =>
          api.mutate<(typeof files)[number]>("/api/files", role, "POST", {
            projectId: project.id,
            jobIds,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            contentBase64: await encode(file),
            category: blueprintMode
              ? "Plans"
              : file.type.startsWith("image/")
                ? "Photos"
                : "Other",
            description: form.get("description"),
            captureDate: file.type.startsWith("image/")
              ? form.get("captureDate")
              : "",
            geoLatitude: file.type.startsWith("image/") ? gps.lat : undefined,
            geoLongitude: file.type.startsWith("image/") ? gps.lng : undefined,
            visibility: form.get("visibility"),
          }),
        ),
      );
      setFiles((current) => [...saved, ...current]);
      formElement.reset();
      setGps({});
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "Upload failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeFile = async (file: (typeof files)[number]) => {
    if (!window.confirm("Permanently delete this file? This cannot be undone."))
      return;
    setBusy(true);
    try {
      await api.mutate(`/api/files/${file.id}`, role, "DELETE");
      setFiles((current) => current.filter((item) => item.id !== file.id));
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Unable to delete this file.",
      );
    } finally {
      setBusy(false);
    }
  };
  const canManage = (file: PortalFile) => role === "admin" || (role === "subcontractor" && file.uploadedBy === data.viewer.id);
  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setUploadError("");
    try {
      const updated = await api.mutate<PortalFile>(`/api/files/${editing.id}`, role, "PATCH", {
        name: form.get("name"), description: form.get("description"), category: form.get("category"),
        ...(role === "admin" ? {
          visibility: form.get("visibility"),
          jobIds: [],
        } : {}),
      });
      setFiles((current) => current.map((file) => file.id === updated.id ? updated : file));
      setEditing(null);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "Unable to update this file."); }
    finally { setBusy(false); }
  };
  const images = files.filter((file) => file.mimeType.startsWith("image/"));
  const otherFiles = files.filter(
    (file) => !file.mimeType.startsWith("image/"),
  );
  return (
    <Modal
      title={`${project.name} ${blueprintMode ? "plans & blueprints" : "files"}`}
      eyebrow={`${files.length} available document${files.length === 1 ? "" : "s"}`}
      onClose={() => {
        if (preview) URL.revokeObjectURL(preview.url);
        onClose();
      }}
      wide
    >
      {(role === "admin" || role === "subcontractor") && (
        <form className="form-grid project-photo-upload" onSubmit={upload}>
          <div className="callout callout-accent">
            <FileUp size={18} />
            <span>
              <strong>
                {blueprintMode
                  ? "Upload blueprints & plans"
                  : "Upload project files"}
              </strong>
              <small>
                {blueprintMode
                  ? "Upload one or more plans or blueprint documents. Uploaded items appear below."
                  : "Select one or more files of any type. Photos can include capture date and optional GPS mapping."}
              </small>
            </span>
          </div>
          <Field label={blueprintMode ? "Plans / blueprints" : "Files"}>
            <input name="files" type="file" multiple required />
          </Field>
          <Field label="Photo capture date">
            <input
              name="captureDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Visible to">
            <select name="visibility" value={uploadAudience} onChange={(event) => setUploadAudience(event.target.value as FileVisibility)}>
              {role === "admin" ? (
                <>
                  <option value="admin">Admin only</option>
                  <option value="client">Admin + Client</option>
                  <option value="assigned_subcontractor">Admin + Subcontractor</option>
                  <option value="client_and_assigned_subcontractor">Admin + Client + Subcontractor</option>
                </>
              ) : (
                <option value="assigned_subcontractor">Subcontractor</option>
              )}
            </select>
          </Field>
          <Field label="Description">
            <input
              name="description"
              placeholder={
                blueprintMode
                  ? "Plan set, revision, drawing notes…"
                  : "Plans, photos, invoices, field notes…"
              }
            />
          </Field>
          {uploadError && (
            <p className="form-error" role="alert">
              {uploadError}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={useLocation}
            >
              Use current GPS location
            </button>
            <small>
              {gps.lat !== undefined
                ? `GPS saved: ${gps.lat.toFixed(5)}, ${gps.lng?.toFixed(5)}`
                : "GPS is optional and is saved for image files only."}
            </small>
            <SubmitButton busy={busy}>Upload selected files</SubmitButton>
          </div>
        </form>
      )}
      {images.length > 0 && (
        <section className="photo-gallery">
          <h3>Photo gallery</h3>
          <div>
            {images.map((file) => (
              <div className="file-control" key={file.id}>
              <button
                type="button"
                onClick={() => void openPreview(file)}
              >
                {thumbnails[file.id] && !unavailablePhotos[file.id] ? (
                  <img
                    src={thumbnails[file.id]}
                    alt="Project photo"
                    onError={() =>
                      setUnavailablePhotos((current) => ({
                        ...current,
                        [file.id]: true,
                      }))
                    }
                  />
                ) : (
                  <span>
                    {unavailablePhotos[file.id]
                      ? "Photo unavailable"
                      : "Loading photo…"}
                  </span>
                )}
              </button>
              {canManage(file) && <details className="item-actions file-item-actions"><summary aria-label={`Actions for ${file.name}`}>⋮</summary><div><button type="button" onClick={() => beginEdit(file)}>Edit</button><button type="button" onClick={() => void removeFile(file)}>Delete</button></div></details>}
              </div>
            ))}
          </div>
        </section>
      )}
      {!blueprintMode && otherFiles.length > 0 && (
        <section className="file-list plan-file-list">
          <h3>Uploaded files</h3>
          <div className="plan-icons">
            {otherFiles.map((file) => (
              <div className="plan-icon file-control" key={file.id}>
                <button type="button" className="plan-download" onClick={() => void openPreview(file)} title={`View ${file.name}`}><FileText size={34} /><span>View</span></button>
                {canManage(file) && <details className="item-actions file-item-actions"><summary aria-label={`Actions for ${file.name}`}>⋮</summary><div><button type="button" onClick={() => beginEdit(file)}>Edit</button><button type="button" onClick={() => void removeFile(file)}>Delete</button></div></details>}
              </div>
            ))}
          </div>
        </section>
      )}
      {editing && <form className="form-grid file-edit-form" onSubmit={saveEdit}>
        <div className="callout callout-accent"><FileText size={18}/><span><strong>Edit {editing.mimeType.startsWith("image/") ? "photo" : "file"}</strong><small>Only the person who uploaded this item, or an Admin, can make changes.</small></span></div>
        <Field label="File name"><input name="name" required defaultValue={editing.name}/></Field>
        <Field label="Category"><input name="category" defaultValue={editing.category || ""}/></Field>
        <Field label="Description"><input name="description" defaultValue={editing.description || ""}/></Field>
        {role === "admin" && <Field label="Visible to"><select name="visibility" value={editAudience} onChange={(event) => setEditAudience(event.target.value as FileVisibility)}><option value="admin">Admin only</option><option value="client">Admin + Client</option><option value="assigned_subcontractor">Admin + Subcontractor</option><option value="client_and_assigned_subcontractor">Admin + Client + Subcontractor</option></select></Field>}
        <div className="form-actions"><button className="button button-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button><SubmitButton busy={busy}>Save changes</SubmitButton></div>
      </form>}
      {preview && (
        <section className="photo-lightbox">
          <button
            type="button"
            aria-label="Close photo"
            onClick={() => {
              URL.revokeObjectURL(preview.url);
              setPreview(null);
            }}
          >
            ×
          </button>
          {preview.mimeType.startsWith("image/") ? <img src={preview.url} alt={preview.name} /> : preview.mimeType === "application/pdf" || preview.mimeType.startsWith("text/") || preview.name.match(/\.(pdf|txt|csv|json|md)$/i) ? <iframe src={preview.url} title={preview.name} className="file-preview-frame" /> : <div className="preview-unavailable"><FileText size={40}/><strong>Preview not available</strong><small>Download this file to open it with its compatible application.</small></div>}
          <p>{preview.name}</p><button className="button button-small button-primary" onClick={() => { const file = files.find((item) => item.name === preview.name); if (file) void api.downloadFile(file.id, file.name, role); }}>Download</button>
        </section>
      )}
      {blueprintMode && files.length > 0 && (
        <section className="file-list plan-file-list">
          <h3>Uploaded plans</h3>
          <div className="plan-icons">
            {files.map((file) => (
              <div className="plan-icon file-control" key={file.id}>
                <button
                  type="button"
                  className="plan-download"
                  title="View blueprint"
                  aria-label="View blueprint"
                  onClick={() =>
                    void openPreview(file)
                  }
                >
                  <FileText size={34} />
                  <span>View</span>
                </button>
                {canManage(file) && <details className="item-actions file-item-actions"><summary aria-label={`Actions for ${file.name}`}>⋮</summary><div><button type="button" onClick={() => beginEdit(file)}>Edit</button><button type="button" onClick={() => void removeFile(file)}>Delete</button></div></details>}
              </div>
            ))}
          </div>
        </section>
      )}
      {!files.length && (
        <EmptyState
          title="No files available"
          detail="Upload project files to share them with authorized project users."
        />
      )}
    </Modal>
  );
}
