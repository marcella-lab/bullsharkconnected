import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  FileSignature,
  FolderKanban,
  HardHat,
  MapPin,
  MessageSquareText,
  Send,
  Sparkles,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Mutation } from "./AdminPages";
import { api } from "./api";
import { ProjectFilesModal } from "./OperationsPages";
import { currency, dateLabel, EmptyState, Field, Modal, PageHeading, ProgressBar, StatusPill, SubmitButton, WorkStatusStrip, YardageReferenceSheet } from "./components";
import type { BootstrapPayload, InterestSubmission, Job } from "./types";

const jobProject = (data: BootstrapPayload, job: Job) => data.projects.find((project) => project.id === job.projectId);

export function ClientPages({ data, view }: { data: BootstrapPayload; view: string }) {
  const scheduled = [...data.jobs].filter((job) => job.scheduleStart).sort((a, b) => (a.scheduleStart || "").localeCompare(b.scheduleStart || ""));
  const content = (() => {
    if (view === "schedule") return <ClientSchedule data={data} scheduled={scheduled} />;
    if (view === "projects") return <ClientProjects data={data} />;
    if (view === "progress") return <ClientProgress data={data} />;
    if (view === "documents") return <InfoPage eyebrow="Project records" title="Documents" detail="Approved plans, selections, and closeout files will appear here." icon={<ClipboardCheck />} />;
    if (view === "messages") return <InfoPage eyebrow="Project communication" title="Messages" detail="Your BullShark project team is your single point of contact for field questions and schedule changes." icon={<MessageSquareText />} />;
    return <ClientOverview data={data} scheduled={scheduled} />;
  })();
  return content;
}

function ClientOverview({ data, scheduled }: { data: BootstrapPayload; scheduled: Job[] }) {
  const first = data.projects[0];
  return <>
    <PageHeading eyebrow="Client project center" title={`Welcome back, ${data.viewer.name.split(" ")[0]}.`} detail="See exactly what is happening on your project and when crews are scheduled on site." />
    {first ? <>
      <section className="client-hero"><div><span>{first.number}</span><h2>{first.name}</h2><p><MapPin size={15} /> {first.address}</p></div><div className="hero-progress"><strong>{first.progress}%</strong><span>Overall progress</span></div></section>
      <section className="metric-grid client-metrics"><article className="metric-card"><span>Current stage</span><strong className="metric-text">{first.currentStage}</strong><small>Updated by your project manager</small></article><article className="metric-card"><span>Scheduled jobs</span><strong>{scheduled.length}</strong><small>Published field commitments</small></article><article className="metric-card"><span>Next crew date</span><strong className="metric-text">{dateLabel(scheduled[0]?.scheduleStart)}</strong><small>{scheduled[0]?.title || "No job scheduled"}</small></article></section>
      <div className="dashboard-grid"><section className="panel span-two"><div className="panel-heading"><div><h2>Upcoming job schedule</h2><p>Dates crews are expected on site</p></div></div><ClientScheduleRows data={data} jobs={scheduled.slice(0, 4)} /></section><section className="panel"><div className="panel-heading"><div><h2>Project progress</h2><p>Current completion</p></div></div><div className="large-progress"><strong>{first.progress}%</strong><ProgressBar value={first.progress} /><span>{first.currentStage}</span><small>Target completion {dateLabel(first.targetDate)}</small></div></section></div>
    </> : <EmptyState title="No project assigned" detail="BullShark will add your project when it is ready." />}
  </>;
}

function ClientProjects({ data }: { data: BootstrapPayload }) {
  const [selected, setSelected] = useState<BootstrapPayload["projects"][number] | null>(null);
  return <><PageHeading eyebrow="My work" title="My projects" detail="Every job scope is organized beneath the project it belongs to." /><div className="project-stack">{data.projects.map((project) => <section className="project-card client-project" key={project.id}><header><div className="project-identity"><span className="project-code">{project.number}</span><h2>{project.name}</h2><p><MapPin size={14} /> {project.address}</p></div><div className="project-summary"><div><small>Stage</small><strong>{project.currentStage}</strong></div><div><small>Progress</small><strong>{project.progress}%</strong></div><div><small>Target</small><strong>{dateLabel(project.targetDate)}</strong></div></div><button className="button button-secondary" onClick={() => setSelected(project)}>Files</button></header><ProgressBar value={project.progress} /><div className="client-job-grid">{data.jobs.filter((job) => job.projectId === project.id).map((job) => <article key={job.id}><div><StatusPill tone={job.status === "in_progress" ? "cyan" : job.status === "scheduled" ? "orange" : "neutral"}>{job.status.replaceAll("_", " ")}</StatusPill><small>{job.number}</small></div><h3>{job.title}</h3><p>{job.scope}</p><dl><div><dt>Stage</dt><dd>{job.stage}</dd></div><div><dt>Progress</dt><dd>{job.progress}%</dd></div><div><dt>Scheduled</dt><dd>{job.scheduleStart ? `${dateLabel(job.scheduleStart)} – ${dateLabel(job.scheduleEnd)}` : "Pending"}</dd></div></dl></article>)}</div></section>)}</div>{selected && <ProjectFilesModal data={data} project={selected} role="client" onClose={() => setSelected(null)} />}</>;
}

function ClientSchedule({ data, scheduled }: { data: BootstrapPayload; scheduled: Job[] }) {
  return <><PageHeading eyebrow="Published field dates" title="Job schedule" detail="These are the dates BullShark has scheduled work to take place on your project." /><section className="schedule-banner"><CalendarCheck2 /><div><strong>{scheduled.length} scheduled job{scheduled.length === 1 ? "" : "s"}</strong><span>Schedule changes published by BullShark appear here immediately.</span></div></section><section className="panel"><ClientScheduleRows data={data} jobs={scheduled} /></section></>;
}

function ClientScheduleRows({ data, jobs }: { data: BootstrapPayload; jobs: Job[] }) {
  if (!jobs.length) return <EmptyState title="Schedule is being prepared" detail="Your project manager will publish field dates here." />;
  return <div className="client-schedule">{jobs.map((job) => <article key={job.id}><span className="date-block"><b>{dateLabel(job.scheduleStart).split(" ")[1]?.replace(",", "")}</b><small>{dateLabel(job.scheduleStart).split(" ")[0]}</small></span><div><small>{jobProject(data, job)?.name}</small><strong>{job.title}</strong><p>{dateLabel(job.scheduleStart)} through {dateLabel(job.scheduleEnd)}</p></div><span className="crew-chip"><HardHat size={15} /> {job.contractorName || "BullShark crew"}</span></article>)}</div>;
}

function ClientProgress({ data }: { data: BootstrapPayload }) {
  return <><PageHeading eyebrow="Stage tracking" title="Project progress" detail="BullShark updates each job as work moves through its field stages." /><div className="progress-page">{data.projects.map((project) => <section className="panel" key={project.id}><div className="panel-heading"><div><small>{project.number}</small><h2>{project.name}</h2></div><strong className="large-number">{project.progress}%</strong></div><ProgressBar value={project.progress} /><div className="stage-job-list">{data.jobs.filter((job) => job.projectId === project.id).map((job) => <article key={job.id}><span className={job.progress === 100 ? "stage-check complete" : "stage-check"}>{job.progress === 100 ? <CheckCircle2 /> : <Clock3 />}</span><div><strong>{job.title}</strong><small>{job.stage}</small></div><span>{job.progress}%</span></article>)}</div></section>)}</div></>;
}

function InfoPage({ eyebrow, title, detail, icon }: { eyebrow: string; title: string; detail: string; icon: React.ReactNode }) {
  return <><PageHeading eyebrow={eyebrow} title={title} detail={detail} /><section className="panel info-panel"><span>{icon}</span><h2>{title} workspace</h2><p>{detail}</p><small>Contact operations@bullsharkconnected.org for immediate assistance.</small></section></>;
}

export function SubcontractorPages({ data, view, mutate, onOpenProject, onOpenJob }: { data: BootstrapPayload; view: string; mutate: Mutation; onOpenProject?: (project: import("./types").Project) => void; onOpenJob?: (job: Job) => void }) {
  // The server includes the viewer's job IDs for both older contractor
  // records and newly created subcontractor accounts.
  const assignedJobIds = new Set(data.users?.find((user) => user.id === data.viewer.id)?.jobIds || []);
  const assigned = data.jobs.filter((job) => assignedJobIds.has(job.id));
  const potential = data.jobs.filter((job) => job.interestOpen);
  const scheduled = assigned.filter((job) => job.scheduleStart).sort((a, b) => (a.scheduleStart || "").localeCompare(b.scheduleStart || ""));
  if (view === "jobs") return <SubJobs data={data} jobs={assigned} onOpenProject={onOpenProject} onOpenJob={onOpenJob} />;
  if (view === "schedule") return <SubSchedule data={data} jobs={scheduled} />;
  if (view === "contracts") return <SubContracts data={data} mutate={mutate} />;
  if (view === "potential") return <PotentialJobs data={data} jobs={potential} mutate={mutate} />;
  if (view === "messages") return <InfoPage eyebrow="Field communication" title="Messages" detail="Coordinate scope and field dates with the BullShark operations team." icon={<MessageSquareText />} />;
  return <SubOverview data={data} assigned={assigned} potential={potential} scheduled={scheduled} mutate={mutate} onOpenJob={onOpenJob} />;
}

function SubOverview({ data, assigned, potential, scheduled, mutate, onOpenJob }: { data: BootstrapPayload; assigned: Job[]; potential: Job[]; scheduled: Job[]; mutate: Mutation; onOpenJob?: (job: Job) => void }) {
  return <><PageHeading eyebrow="Subcontractor hub" title={`Welcome back, ${data.viewer.name.split(" ")[0]}.`} detail="Your assigned jobs, published field schedule, agreements, and potential work." /><WorkStatusStrip jobs={assigned} /><section className="metric-grid"><article className="metric-card"><span>Assigned jobs</span><strong>{assigned.length}</strong><small>{assigned.filter((job) => job.status !== "complete").length} active scopes</small></article><article className="metric-card"><span>Scheduled</span><strong>{scheduled.length}</strong><small>Upcoming field commitments</small></article><article className="metric-card"><span>Contracts</span><strong>{data.contracts.length}</strong><small>{data.contracts.filter((contract) => contract.status === "ready" || contract.status === "sent").length} awaiting signature</small></article><article className="metric-card"><span>Potential jobs</span><strong>{potential.length}</strong><small>Open for interest</small></article></section><div className="dashboard-grid"><section className="panel span-two"><div className="panel-heading"><div><h2>Next on site</h2><p>Your upcoming field commitments</p></div></div>{scheduled.length ? <div className="sub-schedule-mini">{scheduled.slice(0, 3).map((job) => <button className="sub-next-on-site-job" type="button" key={job.id} onClick={() => onOpenJob?.(job)}><CalendarDays /><span><small>{dateLabel(job.scheduleStart)} – {dateLabel(job.scheduleEnd)}</small><strong>{job.title}</strong><p>{job.location || jobProject(data, job)?.address || "Address not set"}</p></span></button>)}</div> : <EmptyState title="Schedule clear" detail="New assignments will appear here." />}</section><section className="panel"><div className="panel-heading"><div><h2>Potential work</h2><p>Open scopes</p></div></div><div className="compact-list">{potential.slice(0, 3).map((job) => <article key={job.id}><span className="mini-icon"><HardHat /></span><span><strong>{job.title}</strong><small>{currency.format(job.price)} · Due {dateLabel(job.bidDue)}</small></span></article>)}</div></section></div>{potential.length > 0 && <PotentialJobs data={data} jobs={potential} mutate={mutate} embedded />}</>;
}

function SubJobs({ data, jobs, onOpenProject, onOpenJob }: { data: BootstrapPayload; jobs: Job[]; onOpenProject?: (project: import("./types").Project) => void; onOpenJob?: (job: Job) => void }) {
  const [selected, setSelected] = useState<BootstrapPayload["projects"][number] | null>(null);
  return <><PageHeading eyebrow="Assigned scopes" title="My jobs" detail="Scope, project location, dates, and progress for every job assigned to you." />{jobs.length === 0 ? <EmptyState title="No assigned jobs" detail="Accepted work will appear here as soon as BullShark makes an assignment." /> : <div className="assigned-grid">{jobs.map((job) => <article className="assigned-card" key={job.id}><header><StatusPill tone={job.status === "in_progress" ? "cyan" : "orange"}>{job.status.replaceAll("_", " ")}</StatusPill><span>{job.number}</span></header><h2>{job.title}</h2><p>{job.scope}</p><div className="location-line"><MapPin size={15} /> {job.location}</div><div className="assigned-facts"><span><small>Project</small><strong>{jobProject(data, job)?.name}</strong></span><span><small>Field dates</small><strong>{job.scheduleStart ? `${dateLabel(job.scheduleStart)} – ${dateLabel(job.scheduleEnd)}` : "Pending"}</strong></span><span><small>Contract value</small><strong>{currency.format(job.price)}</strong></span></div>{jobProject(data, job) && <YardageReferenceSheet project={jobProject(data, job)!} rows={data.yardageRows || []} />}{jobProject(data, job)?.fieldNotes && <section className="sub-field-notes"><strong>Field notes</strong><p>{jobProject(data, job)?.fieldNotes}</p></section>}<button className="button button-small" onClick={() => { const project = jobProject(data, job); if (project) setSelected(project); }}>Project files</button><footer><span>{job.stage}</span><strong>{job.progress}%</strong></footer><ProgressBar value={job.progress} /></article>)}</div>}{selected && <ProjectFilesModal data={data} project={selected} role="subcontractor" onClose={() => setSelected(null)} />}</>;
}

function SubSchedule({ data, jobs }: { data: BootstrapPayload; jobs: Job[] }) {
  return <><PageHeading eyebrow="Field commitments" title="My schedule" detail="BullShark-published dates for the work assigned to your company." />{jobs.length === 0 ? <EmptyState title="No scheduled work" detail="Assigned dates will appear here when BullShark publishes the schedule." /> : <div className="sub-calendar">{jobs.map((job) => <article key={job.id}><div className="calendar-range"><span><small>START</small><strong>{dateLabel(job.scheduleStart)}</strong></span><ArrowRight /><span><small>FINISH</small><strong>{dateLabel(job.scheduleEnd)}</strong></span></div><div><small>{job.number}</small><h2>{job.title}</h2><p>{jobProject(data, job)?.name} · {job.location}</p></div><StatusPill tone="cyan">{job.status.replaceAll("_", " ")}</StatusPill></article>)}</div>}</>;
}

function SubContracts({ data, mutate }: { data: BootstrapPayload; mutate: Mutation }) {
  const [signing, setSigning] = useState<BootstrapPayload["contracts"][number] | null>(null); const [busy, setBusy] = useState(false);
  const sign = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!signing) return; const form = new FormData(event.currentTarget); setBusy(true); void mutate(`/api/contracts/${signing.id}/sign`, "POST", { signerName: form.get("signerName"), signerTitle: form.get("signerTitle"), accepted: form.get("accepted") === "on" }).then(() => setSigning(null)).catch(() => undefined).finally(() => setBusy(false)); };
  return <><PageHeading eyebrow="Agreements" title="My contracts" detail="Review, sign, and download agreements generated for your assigned work." />{data.contracts.length === 0 ? <EmptyState title="No contracts available" detail="Your agreements will appear here when BullShark assigns work." /> : <div className="contract-grid">{data.contracts.map((contract) => { const job = data.jobs.find((item) => item.id === contract.jobId); return <article className="contract-card" key={contract.id}><header><span className="document-icon"><FileSignature /></span><StatusPill tone={contract.status === "signed" ? "green" : "cyan"}>{contract.status}</StatusPill></header><small>{contract.contractNumber}</small><h2>{job?.title}</h2><p>{currency.format(contract.price)}</p><footer>{contract.status !== "signed" && <button className="button button-small button-primary" onClick={() => setSigning(contract)}><FileSignature size={15} /> Sign</button>}<button className="button button-small button-dark" onClick={() => void api.downloadContract(contract.id, contract.contractNumber, "subcontractor")}><Download size={15} /> Open & Download</button></footer></article>; })}</div>}{signing && <Modal title="Sign contract" eyebrow={signing.contractNumber} onClose={() => setSigning(null)}><form className="form-grid" onSubmit={sign}><div className="callout callout-accent"><FileSignature size={18}/><span><strong>Electronic signature</strong><small>Your typed name will be applied to the signed PDF and recorded with the date and time.</small></span></div><Field label="Legal signer name"><input name="signerName" required defaultValue={data.viewer.name}/></Field><Field label="Title / authority"><input name="signerTitle" required placeholder="Owner, President, Authorized Representative"/></Field><label className="check-field"><input name="accepted" type="checkbox" required/><span><strong>I agree to sign electronically</strong><small>I confirm I am authorized to sign this agreement for my company.</small></span></label><div className="form-actions"><button className="button button-ghost" type="button" onClick={() => setSigning(null)}>Cancel</button><SubmitButton busy={busy}>Apply signature</SubmitButton></div></form></Modal>}</>;
}

function PotentialJobs({ data, jobs, mutate, embedded = false }: { data: BootstrapPayload; jobs: Job[]; mutate: Mutation; embedded?: boolean }) {
  const [selected, setSelected] = useState<Job | null>(null);
  const [confirmation, setConfirmation] = useState<{ submission: InterestSubmission; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const existingIds = useMemo(() => new Set(data.interests.map((interest) => interest.jobId)), [data.interests]);
  const submitInterest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget); setBusy(true);
    try {
      const result = await mutate<{ submission: InterestSubmission; message: string }>(`/api/jobs/${selected.id}/interests`, "POST", { phone: form.get("phone"), availability: form.get("availability"), notes: form.get("notes") });
      setConfirmation(result);
    } catch { /* App-level toast reports the error. */ } finally { setBusy(false); }
  };
  return <section className={embedded ? "embedded-section" : undefined}>{!embedded && <PageHeading eyebrow="Open opportunities" title="Potential jobs" detail="Review the posted scope, plans, and files before telling BullShark you are interested." />}<div className="potential-grid">{jobs.map((job) => { const potential = data.potentialJobs?.find((item) => item.id === job.id); const files = data.files?.filter((file) => potential?.fileIds.includes(file.id)) || []; return <article className="potential-card" key={job.id}><header><span><small>{job.number}</small><StatusPill tone="orange">Bids due {dateLabel(job.bidDue)}</StatusPill></span><strong>{currency.format(job.price)}</strong></header><h2>{job.title}</h2><p>{job.scope}</p><div><MapPin size={15} /> {job.location}</div>{files.length > 0 && <div className="file-chip-list">{files.map((file) => <button className="file-chip" key={file.id} onClick={() => void api.downloadFile(file.id, file.name, "subcontractor")}>Open {file.name}</button>)}</div>}<footer><span>{jobProject(data, job)?.name}</span><button className="button button-primary" disabled={existingIds.has(job.id)} onClick={() => { setSelected(job); setConfirmation(null); }}>{existingIds.has(job.id) ? "Interest submitted" : "I’m interested"} {!existingIds.has(job.id) && <ArrowRight size={15} />}</button></footer></article>; })}</div>{selected && <Modal title={confirmation ? "Interest received" : "Complete your interest form"} eyebrow={selected.number} onClose={() => { setSelected(null); setConfirmation(null); }}>{confirmation ? <div className="confirmation"><span><CheckCircle2 /></span><h3>Thanks, {data.viewer.name.split(" ")[0]}.</h3><p>{confirmation.message}</p><dl><div><dt>Confirmation</dt><dd>{confirmation.submission.id}</dd></div><div><dt>Job</dt><dd>{selected.title}</dd></div><div><dt>Availability</dt><dd>{confirmation.submission.availability}</dd></div></dl><div className="next-step"><Sparkles size={17} /><span><strong>What happens next?</strong><small>The operations team will review your scope fit and contact you at {confirmation.submission.contractorEmail}.</small></span></div><button className="button button-primary button-full" onClick={() => { setSelected(null); setConfirmation(null); }}>Return to potential jobs</button></div> : <form className="form-grid" onSubmit={submitInterest}><div className="callout callout-accent"><Send size={18} /><span><strong>{selected.title}</strong><small>{selected.scope}</small></span></div><Field label="Best phone number"><input required name="phone" type="tel" defaultValue={data.contractors[0]?.phone} /></Field><Field label="Crew availability"><input required name="availability" placeholder="Example: Available September 8–22" /></Field><Field label="Message to BullShark"><textarea name="notes" rows={5} placeholder="Share crew size, questions, or relevant experience." /></Field><p className="privacy-note">Submitting sends these details to BullShark operations for this job only.</p><div className="form-actions"><button type="button" className="button button-ghost" onClick={() => setSelected(null)}>Cancel</button><SubmitButton busy={busy}>Submit interest</SubmitButton></div></form>}</Modal>}</section>;
}
