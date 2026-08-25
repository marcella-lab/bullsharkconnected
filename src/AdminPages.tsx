import {
  ArrowRight,
  CalendarPlus,
  Download,
  FilePlus2,
  FileSignature,
  FolderPlus,
  HardHat,
  History,
  MapPin,
  PencilLine,
  Send,
  Settings2,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "./api";
import { ProjectFilesModal } from "./OperationsPages";
import { currency, dateLabel, EmptyState, Field, Modal, PageHeading, ProgressBar, StatusPill, SubmitButton } from "./components";
import type { BootstrapPayload, Contract, Job, PortalSettings, Project } from "./types";

export type Mutation = <T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => Promise<T>;

const toneForStatus = (status: string) => status === "complete" || status === "signed"
  ? "green"
  : status === "blocked" || status === "failed"
    ? "red"
    : status === "in_progress" || status === "sent" || status === "ready"
      ? "cyan"
      : status === "scheduled"
        ? "orange"
        : "neutral";

export function AdminOverview({ data, onView }: { data: BootstrapPayload; onView: (view: string) => void }) {
  const assigned = data.jobs.filter((job) => job.contractorId).length;
  const scheduled = data.jobs.filter((job) => job.scheduleStart).length;
  const contractTotal = data.contracts.reduce((total, contract) => total + contract.price, 0);
  const upcoming = [...data.jobs].filter((job) => job.scheduleStart).sort((a, b) => (a.scheduleStart || "").localeCompare(b.scheduleStart || "")).slice(0, 4);
  return (
    <>
      <PageHeading eyebrow="Company command center" title="Good morning, Marcella." detail="Projects, field schedules, contracts, and decisions in one operating view." actions={<button className="button button-primary" onClick={() => onView("projects")}><FolderPlus size={17} /> Add project or job</button>} />
      <section className="metric-grid">
        <article className="metric-card"><span>Active projects</span><strong>{data.projects.filter((project) => project.status === "active").length}</strong><small>{data.jobs.length} individual jobs</small></article>
        <article className="metric-card"><span>Assigned jobs</span><strong>{assigned}</strong><small>{scheduled} on the field schedule</small></article>
        <article className="metric-card"><span>Contract pipeline</span><strong>{currency.format(contractTotal)}</strong><small>{data.contracts.length} generated contracts</small></article>
        <article className="metric-card"><span>New interest</span><strong>{data.interests.filter((interest) => interest.status === "new").length}</strong><small>Subcontractor responses</small></article>
      </section>
      <div className="dashboard-grid">
        <section className="panel span-two">
          <div className="panel-heading"><div><h2>Project pulse</h2><p>Stage and progress across active projects</p></div><button className="text-button" onClick={() => onView("projects")}>Manage all <ArrowRight size={15} /></button></div>
          <div className="project-pulse-list">
            {data.projects.map((project) => (
              <article key={project.id}>
                <div className="pulse-top"><span><small>{project.number}</small><strong>{project.name}</strong></span><b>{project.progress}%</b></div>
                <ProgressBar value={project.progress} />
                <div className="pulse-bottom"><span>{project.currentStage}</span><span>Target {dateLabel(project.targetDate)}</span></div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>Next on site</h2><p>Upcoming field commitments</p></div></div>
          <div className="compact-list">
            {upcoming.map((job) => (
              <article key={job.id}>
                <span className="date-tile"><b>{dateLabel(job.scheduleStart).split(" ")[1]?.replace(",", "")}</b><small>{dateLabel(job.scheduleStart).split(" ")[0]}</small></span>
                <span><strong>{job.title}</strong><small>{job.contractorName || "Crew not assigned"}</small></span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

type DialogState =
  | { type: "project" }
  | { type: "job"; project: Project }
  | { type: "schedule"; job: Job }
  | { type: "progress"; job: Job }
  | { type: "assign"; job: Job }
  | { type: "edit-job"; job: Job }
  | { type: "files"; project: Project }
  | { type: "plans"; project: Project }
  | null;

export function AdminProjects({ data, mutate, canCreate = true }: { data: BootstrapPayload; mutate: Mutation; canCreate?: boolean }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); setDialog(null); } catch { /* App-level toast reports the error. */ } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeading eyebrow="Project operations" title="Projects & jobs" detail="Organize each field scope under its parent project, then assign, schedule, and track it." actions={canCreate ? <button className="button button-primary manager-allowed" onClick={() => setDialog({ type: "project" })}><FolderPlus size={17} /> New project</button> : undefined} />
      <div className="project-stack">
        {data.projects.map((project) => {
          const jobs = data.jobs.filter((job) => job.projectId === project.id);
          return (
            <section className="project-card" key={project.id}>
              <header>
                <div className="project-identity"><span className="project-code">{project.number}</span><h2>{project.name}</h2><p><MapPin size={14} /> {project.address}</p></div>
                <div className="project-summary"><div><small>Stage</small><strong>{project.currentStage}</strong></div><div><small>Progress</small><strong>{project.progress}%</strong></div><div><small>Target</small><strong>{dateLabel(project.targetDate)}</strong></div></div>
                {canCreate && <button className="button button-secondary manager-allowed" onClick={() => setDialog({ type: "job", project })}><FilePlus2 size={16} /> Add job</button>}
                <button className="button button-secondary" onClick={() => setDialog({ type: "files", project })}>Files</button>
                <button className="button button-secondary" onClick={() => setDialog({ type: "plans", project })}>Plans</button>
                <button className="button button-danger" onClick={() => { if (window.confirm(`Delete ${project.name} and all of its jobs? This cannot be undone.`)) void submit(() => mutate(`/api/projects/${project.id}`, "DELETE")); }}><Trash2 size={15} /> Delete project</button>
              </header>
              <ProgressBar value={project.progress} />
              <div className="job-list">
                {jobs.map((job) => (
                  <article className="job-row" key={job.id}>
                    <div className="job-main"><span><StatusPill tone={toneForStatus(job.status)}>{job.status.replaceAll("_", " ")}</StatusPill><small>{job.number}</small></span><h3>{job.title}</h3><p>{job.scope}</p></div>
                    <div className="job-facts"><span><small>Price</small><strong>{currency.format(job.price)}</strong></span><span><small>Client</small><strong>{job.clientName || project.clientName}</strong></span><span><small>Subcontractor</small><strong>{job.contractorName || "Unassigned"}</strong></span><span><small>Schedule</small><strong>{job.scheduleStart ? `${dateLabel(job.scheduleStart)} – ${dateLabel(job.scheduleEnd)}` : "Not scheduled"}</strong></span></div>
                    <div className="job-progress"><strong>{job.progress}%</strong><ProgressBar value={job.progress} /><small>{job.stage}</small></div>
                    <div className="row-actions">
                      <button onClick={() => setDialog({ type: "schedule", job })}><CalendarPlus size={15} /> Schedule</button>
                      <button onClick={() => setDialog({ type: "progress", job })}><PencilLine size={15} /> Progress</button>
                      <button onClick={() => setDialog({ type: "edit-job", job })}><PencilLine size={15} /> Edit job</button>
                      <button className="action-emphasis" onClick={() => setDialog({ type: "assign", job })}><UserRoundCheck size={15} /> {job.contractorId ? "Reassign" : "Assign"}</button>
                      <button className="action-danger" onClick={() => { if (window.confirm(`Delete job ${job.title}? This cannot be undone.`)) void submit(() => mutate(`/api/jobs/${job.id}`, "DELETE")); }}><Trash2 size={15} /> Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {dialog?.type === "project" && <Modal title="Create a project" eyebrow="Parent project" onClose={() => setDialog(null)}><form className="form-grid manager-allowed" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(() => mutate("/api/projects", "POST", { name: form.get("name"), address: form.get("address"), clientId: form.get("clientId"), manager: form.get("manager"), budget: form.get("budget"), startDate: form.get("startDate"), targetDate: form.get("targetDate") })); }}>
        <Field label="Project name"><input required name="name" placeholder="Orgeron Barndominium" /></Field>
        <Field label="Client"><select required name="clientId"><option value="">Select client</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
        <Field label="Project address"><input required name="address" placeholder="City, state or full address" /></Field>
        <Field label="Project manager"><input required name="manager" defaultValue="Marcella Johnson" /></Field>
        <Field label="Project budget"><input required name="budget" type="number" min="0" step="100" /></Field>
        <Field label="Start date"><input required name="startDate" type="date" /></Field>
        <Field label="Target completion"><input required name="targetDate" type="date" /></Field>
        <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>Cancel</button><SubmitButton busy={busy}>Create project</SubmitButton></div>
      </form></Modal>}

      {dialog?.type === "job" && <Modal title={`Add job to ${dialog.project.name}`} eyebrow="Individual job" onClose={() => setDialog(null)} wide><form className="form-grid manager-allowed" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(() => mutate(`/api/projects/${dialog.project.id}/jobs`, "POST", { title: form.get("title"), scope: form.get("scope"), location: form.get("location"), price: form.get("price"), stage: form.get("stage"), scheduleStart: form.get("scheduleStart"), scheduleEnd: form.get("scheduleEnd"), interestOpen: form.get("interestOpen") === "on", bidDue: form.get("bidDue"), clientId: form.get("clientId"), contractorId: form.get("contractorId") })); }}>
        <Field label="Job name"><input required name="title" placeholder="Structural framing" /></Field>
        <Field label="Assigned client"><select required name="clientId" defaultValue={dialog.project.clientId}><option value="">Select client</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field>
        <Field label="Assigned subcontractor"><select name="contractorId"><option value="">Select subcontractor</option>{data.contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.company} · {contractor.trade}</option>)}</select></Field>
        <Field label="Stage"><select name="stage">{data.settings.stages.map((stage) => <option key={stage.name}>{stage.name}</option>)}</select></Field>
        <Field label="Scope" ><textarea required name="scope" rows={3} placeholder="Describe the complete subcontractor scope…" /></Field>
        <Field label="Location"><input required name="location" defaultValue={dialog.project.address} /></Field>
        <Field label="Posted price"><input required type="number" min="0" step="100" name="price" /></Field>
        <Field label="Schedule start"><input type="date" name="scheduleStart" /></Field>
        <Field label="Schedule end"><input type="date" name="scheduleEnd" /></Field>
        <Field label="Bid due"><input type="date" name="bidDue" /></Field>
        <label className="check-field"><input type="checkbox" name="interestOpen" /> <span><strong>Open as a potential job</strong><small>Subcontractors can submit an interest form.</small></span></label>
        <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>Cancel</button><SubmitButton busy={busy}>Add job</SubmitButton></div>
      </form></Modal>}

      {dialog?.type === "edit-job" && <Modal title="Edit job and assigned users" eyebrow={dialog.job.number} onClose={() => setDialog(null)} wide><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(() => mutate(`/api/jobs/${dialog.job.id}`, "PATCH", { title: form.get("title"), scope: form.get("scope"), location: form.get("location"), price: form.get("price"), stage: form.get("stage"), clientId: form.get("clientId"), contractorId: form.get("contractorId") })); }}><Field label="Job name"><input required name="title" defaultValue={dialog.job.title} /></Field><Field label="Stage"><select name="stage" defaultValue={dialog.job.stage}>{data.settings.stages.map((stage) => <option key={stage.name}>{stage.name}</option>)}</select></Field><Field label="Assigned client"><select required name="clientId" defaultValue={dialog.job.clientId || data.projects.find((project) => project.id === dialog.job.projectId)?.clientId}><option value="">Select client</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></Field><Field label="Assigned subcontractor"><select name="contractorId" defaultValue={dialog.job.contractorId || ""}><option value="">No subcontractor selected</option>{data.contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.company} · {contractor.trade}</option>)}</select></Field><Field label="Scope"><textarea required name="scope" rows={3} defaultValue={dialog.job.scope} /></Field><Field label="Location"><input required name="location" defaultValue={dialog.job.location} /></Field><Field label="Job price"><input required type="number" min="0" step="100" name="price" defaultValue={dialog.job.price} /></Field><div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>Cancel</button><SubmitButton busy={busy}>Save job and assignments</SubmitButton></div></form></Modal>}

      {dialog?.type === "schedule" && <Modal title="Schedule job" eyebrow={dialog.job.number} onClose={() => setDialog(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(() => mutate(`/api/jobs/${dialog.job.id}/schedule`, "POST", { scheduleStart: form.get("scheduleStart"), scheduleEnd: form.get("scheduleEnd") })); }}>
        <div className="callout"><CalendarPlus size={18} /><span><strong>{dialog.job.title}</strong><small>Dates are immediately visible to the assigned client and subcontractor.</small></span></div>
        <Field label="Starts"><input required type="date" name="scheduleStart" defaultValue={dialog.job.scheduleStart} /></Field>
        <Field label="Ends"><input required type="date" name="scheduleEnd" defaultValue={dialog.job.scheduleEnd} /></Field>
        <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>Cancel</button><SubmitButton busy={busy}>Publish schedule</SubmitButton></div>
      </form></Modal>}

      {dialog?.type === "progress" && <Modal title="Update stage progress" eyebrow={dialog.job.number} onClose={() => setDialog(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit(() => mutate(`/api/jobs/${dialog.job.id}/progress`, "PATCH", { stage: form.get("stage"), progress: form.get("progress"), status: form.get("status") })); }}>
        <Field label="Project stage"><select name="stage" defaultValue={dialog.job.stage}>{data.settings.stages.map((stage) => <option key={stage.name}>{stage.name}</option>)}</select></Field>
        <Field label="Completion percentage"><input required name="progress" type="number" min="0" max="100" defaultValue={dialog.job.progress} /></Field>
        <Field label="Job status"><select name="status" defaultValue={dialog.job.status}><option value="planned">Planned</option><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="complete">Complete</option></select></Field>
        <div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setDialog(null)}>Cancel</button><SubmitButton busy={busy}>Update progress</SubmitButton></div>
      </form></Modal>}

      {dialog?.type === "assign" && <AssignmentModal data={data} job={dialog.job} busy={busy} close={() => setDialog(null)} submit={(body) => submit(() => mutate(`/api/jobs/${dialog.job.id}/assign`, "POST", body))} />}
      {dialog?.type === "files" && <ProjectFilesModal data={data} project={dialog.project} role="admin" onClose={() => setDialog(null)} />}
      {dialog?.type === "plans" && <ProjectFilesModal data={data} project={dialog.project} role="admin" blueprintMode onClose={() => setDialog(null)} />}
    </>
  );
}

function AssignmentModal({ data, job, busy, close, submit }: { data: BootstrapPayload; job: Job; busy: boolean; close: () => void; submit: (body: unknown) => Promise<void> }) {
  const sequence = String(data.contracts.length + 1).padStart(4, "0");
  return <Modal title="Assign subcontractor" eyebrow={`${job.number} · contract generation`} onClose={close} wide><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit({ contractorId: form.get("contractorId"), contractNumber: form.get("contractNumber"), price: form.get("price"), paymentTerms: form.get("paymentTerms"), notes: form.get("notes"), sendNow: form.get("sendNow") === "on" }); }}>
    <div className="callout callout-accent"><FileSignature size={20} /><span><strong>Contract generated automatically</strong><small>The number and price are populated from the job. You can change both before creating the agreement.</small></span></div>
    <Field label="Subcontractor"><select required name="contractorId" defaultValue={job.contractorId || ""}><option value="">Select subcontractor</option>{data.contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.company} · {contractor.trade}</option>)}</select></Field>
    <Field label="Contract number"><input required name="contractNumber" defaultValue={`${data.settings.contractPrefix}-${sequence}`} /></Field>
    <Field label="Contract price"><input required type="number" min="1" step="1" name="price" defaultValue={job.price} /></Field>
    <Field label="Payment terms"><input required name="paymentTerms" defaultValue={data.settings.paymentTerms} /></Field>
    <Field label="Special terms or notes"><textarea name="notes" rows={4} placeholder="Optional terms for this agreement" /></Field>
    <label className="check-field"><input type="checkbox" name="sendNow" defaultChecked /> <span><strong>Send for e-signature after generation</strong><small>Uses {data.settings.esignProvider === "demo" ? "the local demo provider" : "DocuSign"}. Clear this to leave a draft for review.</small></span></label>
    <div className="form-actions"><button type="button" className="button button-ghost" onClick={close}>Cancel</button><SubmitButton busy={busy}>Assign & generate contract</SubmitButton></div>
  </form></Modal>;
}

export function AdminSchedule({ data, mutate }: { data: BootstrapPayload; mutate: Mutation }) {
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const scheduled = [...data.jobs].filter((item) => item.scheduleStart).sort((a, b) => (a.scheduleStart || "").localeCompare(b.scheduleStart || ""));
  const unscheduled = data.jobs.filter((item) => !item.scheduleStart);
  const schedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!job) return;
    const form = new FormData(event.currentTarget); setBusy(true);
    try { await mutate(`/api/jobs/${job.id}/schedule`, "POST", { scheduleStart: form.get("scheduleStart"), scheduleEnd: form.get("scheduleEnd") }); setJob(null); } catch { /* Keep the form open for correction. */ } finally { setBusy(false); }
  };
  return <>
    <PageHeading eyebrow="Field calendar" title="Job schedule" detail="Publish job dates once and keep Admin, Client, and Subcontractor views synchronized." />
    <div className="schedule-layout"><section className="panel"><div className="panel-heading"><div><h2>Published schedule</h2><p>{scheduled.length} field commitments</p></div></div><div className="schedule-list">{scheduled.map((item) => <article key={item.id}><span className="schedule-date"><b>{dateLabel(item.scheduleStart)}</b><small>through {dateLabel(item.scheduleEnd)}</small></span><span><strong>{item.title}</strong><small>{item.number} · {item.contractorName || "Crew unassigned"}</small></span><StatusPill tone={toneForStatus(item.status)}>{item.status.replaceAll("_", " ")}</StatusPill><button className="button button-small" onClick={() => setJob(item)}>Edit dates</button></article>)}</div></section>
      <aside className="panel"><div className="panel-heading"><div><h2>Needs dates</h2><p>Unscheduled jobs</p></div></div><div className="compact-list">{unscheduled.map((item) => <article key={item.id}><span className="mini-icon"><HardHat size={17} /></span><span><strong>{item.title}</strong><small>{item.number}</small></span><button className="icon-button" aria-label={`Schedule ${item.title}`} onClick={() => setJob(item)}><CalendarPlus size={17} /></button></article>)}</div></aside>
    </div>
    {job && <Modal title="Publish job dates" eyebrow={job.number} onClose={() => setJob(null)}><form className="form-grid" onSubmit={schedule}><Field label="Start date"><input required type="date" name="scheduleStart" defaultValue={job.scheduleStart} /></Field><Field label="End date"><input required type="date" name="scheduleEnd" defaultValue={job.scheduleEnd} /></Field><div className="form-actions"><button className="button button-ghost" type="button" onClick={() => setJob(null)}>Cancel</button><SubmitButton busy={busy}>Save schedule</SubmitButton></div></form></Modal>}
  </>;
}

export function AdminContracts({ data, mutate }: { data: BootstrapPayload; mutate: Mutation }) {
  const [editing, setEditing] = useState<Contract | null>(null);
  const [signing, setSigning] = useState<Contract | null>(null);
  const [busy, setBusy] = useState(false);
  const details = (contract: Contract) => ({ job: data.jobs.find((job) => job.id === contract.jobId), contractor: data.contractors.find((contractor) => contractor.id === contract.contractorId) });
  const send = async (contract: Contract) => { setBusy(true); try { await mutate(`/api/contracts/${contract.id}/send`, "POST"); } catch { /* App-level toast reports the error. */ } finally { setBusy(false); } };
  const sign = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!signing) return; const form = new FormData(event.currentTarget); setBusy(true); void mutate(`/api/contracts/${signing.id}/sign`, "POST", { signerName: form.get("signerName"), signerTitle: form.get("signerTitle"), accepted: form.get("accepted") === "on" }).then(() => setSigning(null)).catch(() => undefined).finally(() => setBusy(false)); };
  return <>
    <PageHeading eyebrow="Agreement center" title="Contracts" detail="Review generated agreements, update editable details, download PDFs, and send envelopes for signature." />
    {data.contracts.length === 0 ? <EmptyState title="No contracts yet" detail="Assign a subcontractor to any job and its contract will be generated automatically." /> : <div className="contract-grid">{data.contracts.map((contract) => { const { job, contractor } = details(contract); return <article className="contract-card" key={contract.id}><header><span className="document-icon"><FileSignature /></span><StatusPill tone={toneForStatus(contract.status)}>{contract.status}</StatusPill></header><small>{contract.contractNumber}</small><h2>{job?.title}</h2><p>{contractor?.company} · {currency.format(contract.price)}</p><dl><div><dt>Created</dt><dd>{new Date(contract.createdAt).toLocaleDateString()}</dd></div><div><dt>Envelope</dt><dd>{contract.envelopeId || "Not sent"}</dd></div></dl>{contract.deliveryError && <p className="inline-error">{contract.deliveryError}</p>}<footer><button className="button button-small" onClick={() => setEditing(contract)}><PencilLine size={15} /> Edit</button>{contract.status !== "signed" && <button className="button button-small button-primary" onClick={() => setSigning(contract)}><FileSignature size={15} /> Sign</button>}<button className="button button-small" onClick={() => void api.downloadContract(contract.id, contract.contractNumber, "admin")}><Download size={15} /> Open & Download</button>{contract.status !== "signed" && <button disabled={busy} className="button button-small button-dark" onClick={() => void send(contract)}><Send size={15} /> Send</button>}<button className="button button-small" onClick={() => { if (window.confirm(`Delete contract ${contract.contractNumber}? This also removes its PDF.`)) void mutate(`/api/contracts/${contract.id}`, "DELETE"); }}>Delete</button></footer></article>; })}</div>}
    {editing && <Modal title="Edit contract details" eyebrow={editing.contractNumber} onClose={() => setEditing(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); void mutate(`/api/contracts/${editing.id}`, "PATCH", { contractNumber: form.get("contractNumber"), price: form.get("price"), paymentTerms: form.get("paymentTerms"), notes: form.get("notes") }).then(() => setEditing(null)).catch(() => undefined).finally(() => setBusy(false)); }}><Field label="Contract number"><input name="contractNumber" required defaultValue={editing.contractNumber} /></Field><Field label="Contract price"><input name="price" required type="number" min="1" defaultValue={editing.price} /></Field><Field label="Payment terms"><input name="paymentTerms" required defaultValue={editing.paymentTerms} /></Field><Field label="Special terms"><textarea name="notes" rows={5} defaultValue={editing.notes} /></Field><div className="callout"><History size={18} /><span><strong>A fresh PDF will be generated.</strong><small>Previously sent envelopes are not altered. Send the regenerated draft when ready.</small></span></div><div className="form-actions"><button className="button button-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button><SubmitButton busy={busy}>Regenerate contract</SubmitButton></div></form></Modal>}
    {signing && <Modal title="Admin sign contract" eyebrow={signing.contractNumber} onClose={() => setSigning(null)}><form className="form-grid" onSubmit={sign}><div className="callout callout-accent"><FileSignature size={18}/><span><strong>Admin signature</strong><small>This records an administrator-completed signature in the contract audit log and regenerates the PDF.</small></span></div><Field label="Signer name"><input name="signerName" required defaultValue={data.viewer.name}/></Field><Field label="Title / authority"><input name="signerTitle" required defaultValue="Authorized Administrator"/></Field><label className="check-field"><input name="accepted" type="checkbox" required/><span><strong>I am authorized to sign</strong><small>I confirm this signature action is authorized.</small></span></label><div className="form-actions"><button className="button button-ghost" type="button" onClick={() => setSigning(null)}>Cancel</button><SubmitButton busy={busy}>Apply signature</SubmitButton></div></form></Modal>}
  </>;
}

export function AdminInterests({ data }: { data: BootstrapPayload }) {
  const rows = data.interests.map((interest) => ({ interest, job: data.jobs.find((job) => job.id === interest.jobId) }));
  return <><PageHeading eyebrow="Subcontractor pipeline" title="Interest inbox" detail="Follow up on potential-job responses with scope, availability, and contact details together." />{rows.length === 0 ? <EmptyState title="No responses yet" detail="New “I’m interested” submissions will appear here immediately." /> : <section className="panel table-panel"><div className="data-table"><div className="data-head"><span>Subcontractor</span><span>Job</span><span>Availability</span><span>Submitted</span><span>Status</span></div>{rows.map(({ interest, job }) => <article key={interest.id}><span><strong>{interest.contractorName}</strong><small>{interest.contractorEmail} · {interest.phone}</small></span><span><strong>{job?.title}</strong><small>{job?.number}</small></span><span>{interest.availability}<small>{interest.notes || "No additional note"}</small></span><span>{new Date(interest.createdAt).toLocaleDateString()}</span><StatusPill tone="orange">{interest.status}</StatusPill></article>)}</div></section>}</>;
}

export function AdminSettings({ data, mutate }: { data: BootstrapPayload; mutate: Mutation }) {
  const [settings, setSettings] = useState<PortalSettings>(data.settings);
  const [stageText, setStageText] = useState(data.settings.stages.map((stage) => `${stage.name} | ${stage.percent}`).join("\n"));
  const [busy, setBusy] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    const stages = stageText.split("\n").map((line) => { const [name, percent] = line.split("|"); return { name: name?.trim(), percent: Number(percent?.trim()) }; }).filter((stage) => stage.name && Number.isFinite(stage.percent));
    try { await mutate("/api/settings", "PATCH", { ...settings, stages }); } catch { /* App-level toast reports the error. */ } finally { setBusy(false); }
  };
  return <><PageHeading eyebrow="Central management" title="Admin settings" detail="Edit shared company data, project stages, e-signature routing, and contract language from one place." /><form className="settings-layout" onSubmit={save}><section className="panel settings-section"><div className="section-title"><span><Settings2 /></span><div><h2>Company & delivery</h2><p>Applied across the operations portal.</p></div></div><div className="form-grid"><Field label="Company name"><input value={settings.companyName} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} /></Field><Field label="Support email"><input type="email" value={settings.supportEmail} onChange={(event) => setSettings({ ...settings, supportEmail: event.target.value })} /></Field><Field label="Contract sender name"><input value={settings.senderName} onChange={(event) => setSettings({ ...settings, senderName: event.target.value })} /></Field><Field label="Contract number prefix"><input value={settings.contractPrefix} onChange={(event) => setSettings({ ...settings, contractPrefix: event.target.value })} /></Field><Field label="Default payment terms"><input value={settings.paymentTerms} onChange={(event) => setSettings({ ...settings, paymentTerms: event.target.value })} /></Field><Field label="E-signature provider" hint="DocuSign credentials stay in server environment variables."><select value={settings.esignProvider} onChange={(event) => setSettings({ ...settings, esignProvider: event.target.value as PortalSettings["esignProvider"] })}><option value="demo">Demo / local review</option><option value="docusign">DocuSign</option></select></Field></div></section><section className="panel settings-section"><div className="section-title"><span><FileSignature /></span><div><h2>Contract template</h2><p>Use the supported merge fields shown below.</p></div></div><div className="token-list">{"{{contractNumber}} {{contractorName}} {{contractorCompany}} {{projectName}} {{jobNumber}} {{jobTitle}} {{location}} {{scope}} {{price}} {{paymentTerms}} {{scheduleStart}} {{scheduleEnd}} {{notes}}".split(" ").map((token) => <code key={token}>{token}</code>)}</div><Field label="Template content"><textarea className="template-editor" rows={20} value={settings.contractTemplate} onChange={(event) => setSettings({ ...settings, contractTemplate: event.target.value })} /></Field></section><section className="panel settings-section"><div className="section-title"><span><HardHat /></span><div><h2>Project stages</h2><p>One stage per line in “Name | percent” format.</p></div></div><Field label="Stages"><textarea rows={10} value={stageText} onChange={(event) => setStageText(event.target.value)} /></Field></section><div className="sticky-save"><span>Changes apply to all new jobs and contracts.</span><SubmitButton busy={busy}>Save global settings</SubmitButton></div></form></>;
}

export function AdminAudit({ data }: { data: BootstrapPayload }) {
  return <><PageHeading eyebrow="System history" title="Audit log" detail="A durable record of admin and subcontractor actions across jobs, contracts, and settings." /><section className="panel"><div className="timeline">{data.audit.map((entry) => <article key={entry.id}><span className="timeline-dot" /><div><strong>{entry.action}</strong><p>{entry.detail}</p><small>{new Date(entry.createdAt).toLocaleString()} · {entry.actorRole}</small></div></article>)}</div></section></>;
}
