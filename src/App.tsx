import { AlertCircle, CheckCircle2, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AdminAudit,
  AdminContracts,
  AdminInterests,
  AdminPotentialJobs,
  AdminOverview,
  AdminProjects,
  AdminSchedule,
  AdminSettings,
} from "./AdminPages";
import { api, clearSessionToken, savedSessionRole, setPreview, setSessionToken } from "./api";
import { Layout } from "./Layout";
import { AdminInvoices, AdminPayRequests, AdminUsers, NotificationsPage, SubPayRequests } from "./OperationsPages";
import { ClientPages, SubcontractorPages } from "./RolePages";
import { YardagePage } from "./YardagePage";
import { FinancePage } from "./FinancePage";
import { SuppliersPage } from "./SuppliersPage";
import { SpendingPage } from "./SpendingPage";
import { JobDetail, ProjectDetail } from "./DetailPages";
import type { BootstrapPayload, Role } from "./types";

type Toast = { id: number; type: "success" | "error"; message: string };

export function App() {
  const [role, setRole] = useState<Role>(() => savedSessionRole() || "admin");
  const [view, setView] = useState("overview");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sessionRole, setSessionRole] = useState<Role | null>(() => savedSessionRole());
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [previewRole, setPreviewRole] = useState<Role | null>(null);
  const [previewUserId, setPreviewUserId] = useState("");
  const [previewAccounts, setPreviewAccounts] = useState<NonNullable<BootstrapPayload["users"]>>([]);
  const [detail, setDetail] = useState<{ type: "project" | "job"; id: string } | null>(null);
  // Several events can request a refresh at once (a save, focus, and the
  // live-update timer).  Only let the newest response change shared state;
  // otherwise an older response can make a just-saved card look reverted.
  const latestRefresh = useRef(0);

  const notify = useCallback((type: Toast["type"], message: string) => {
    const toast = { id: Date.now(), type, message };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 4500);
  }, []);

  const refresh = useCallback(async (activeRole: Role) => {
    const refreshId = ++latestRefresh.current;
    try {
      const next = await api.bootstrap(activeRole);
      if (refreshId !== latestRefresh.current) return;
      setData(next);
      if (activeRole === "admin") setPreviewAccounts(next.users || []);
      setError("");
    } catch (requestError) {
      if (refreshId !== latestRefresh.current) return;
      // Railway deploys restart the server's in-memory session list.  A saved
      // browser token is therefore no longer valid after a deployment; return
      // people to the normal sign-in screen instead of a dead-end error page.
      if ((requestError as { status?: number })?.status === 401) {
        clearSessionToken();
        setPreview(null);
        setSessionRole(null);
        setData(null);
        setError("");
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "Unable to load the portal.");
    }
  }, []);

  useEffect(() => { if (sessionRole) { setData(null); void refresh(role); } }, [role, refresh, sessionRole]);
  useEffect(() => {
    if (!sessionRole) return;
    const reloadSavedData = () => void refresh(role);
    window.addEventListener("bullshark:data-saved", reloadSavedData);
    return () => window.removeEventListener("bullshark:data-saved", reloadSavedData);
  }, [refresh, role, sessionRole]);
  // Keep records current for everyone who already has the portal open. This
  // makes edits made by another user appear without using Back or Refresh.
  useEffect(() => {
    if (!sessionRole) return;
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(role); };
    const interval = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refreshWhenVisible); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [refresh, role, sessionRole]);

  const mutate = useCallback(async <T,>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) => {
    try {
      const result = await api.mutate<T>(path, role, method, body);
      await refresh(role);
      const warning = typeof result === "object" && result && "warning" in result ? String((result as { warning?: string }).warning || "") : "";
      if (warning) notify("error", warning);
      else notify("success", "Changes saved successfully.");
      return result;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to save changes.";
      notify("error", message);
      throw requestError;
    }
  }, [notify, refresh, role]);

  const changeRole = (nextRole: Role, requestedUserId?: string) => {
    if (sessionRole !== "admin") return;
    if (nextRole === "admin") { setPreview(null); setPreviewRole(null); setPreviewUserId(""); }
    else {
      const userId = requestedUserId || previewAccounts.find((user) => user.role === nextRole && user.active)?.id;
      setPreview({ role: nextRole, userId }); setPreviewRole(nextRole); setPreviewUserId(userId || "");
    }
    setRole(nextRole);
    setView("overview");
  };

  if (!sessionRole) return <LoginScreen onSuccess={(nextRole, change) => { setRole(nextRole); setSessionRole(nextRole); setMustChangePassword(change); }} />;
  if (!data && !error) return <div className="boot-screen"><span className="brand-mark">B</span><LoaderCircle className="spin" /><p>Connecting operations…</p></div>;
  if (!data) return <div className="boot-screen error-screen"><AlertCircle /><h1>Portal unavailable</h1><p>{error}</p><button className="button button-primary" onClick={() => void refresh(role)}>Try again</button></div>;

  let page;
  if (role === "admin" || role === "project_manager") {
    if (detail?.type === "project") { const project = data.projects.find((item) => item.id === detail.id); page = project ? <ProjectDetail data={data} role={role} project={project} onBack={() => setDetail(null)} onJob={(job) => setDetail({ type: "job", id: job.id })} /> : <AdminOverview data={data} onView={setView} onOpenJob={(job) => setDetail({ type: "job", id: job.id })} />; }
    else if (detail?.type === "job") { const job = data.jobs.find((item) => item.id === detail.id); page = job ? <JobDetail data={data} role={role} job={job} onBack={() => setDetail({ type: "project", id: job.projectId })} onUpdated={() => void refresh(role)} /> : <AdminOverview data={data} onView={setView} onOpenJob={(job) => setDetail({ type: "job", id: job.id })} />; }
    else if (view === "projects") page = <AdminProjects data={data} mutate={mutate} onOpenProject={(project) => setDetail({ type: "project", id: project.id })} />;
    else if (view === "yardage") page = <YardagePage data={data} mutate={mutate} />;
    else if (view === "financials") page = <FinancePage data={data} mutate={mutate} />;
    else if (view === "suppliers") page = <SuppliersPage data={data} />;
    else if (view === "spending" && role === "admin") page = <SpendingPage data={data} mutate={mutate} />;
    else if (view === "schedule") page = <AdminSchedule data={data} mutate={mutate} />;
    else if (view === "contracts") page = <AdminContracts data={data} mutate={mutate} />;
    else if (view === "interests") page = <AdminInterests data={data} />;
    else if (view === "potential") page = <AdminPotentialJobs data={data} mutate={mutate} />;
    else if (view === "users") page = <AdminUsers data={data} mutate={mutate} />;
    else if (view === "pay-requests") page = <AdminInvoices data={data} mutate={mutate} />;
    else if (view === "notifications") page = <NotificationsPage data={data} mutate={mutate} />;
    else if (view === "settings") page = <AdminSettings data={data} mutate={mutate} />;
    else if (view === "audit") page = <AdminAudit data={data} />;
    else page = <AdminOverview data={data} onView={setView} onOpenJob={(job) => setDetail({ type: "job", id: job.id })} />;
  } else if (role === "client") page = view === "notifications" ? <NotificationsPage data={data} mutate={mutate} /> : <ClientPages data={data} view={view} />;
  else if (detail?.type === "project") { const project = data.projects.find((item) => item.id === detail.id); page = project ? <ProjectDetail data={data} role={role} project={project} onBack={() => setDetail(null)} onJob={(job) => setDetail({ type: "job", id: job.id })} /> : <SubcontractorPages data={data} view="overview" mutate={mutate} />; }
  else if (detail?.type === "job") { const job = data.jobs.find((item) => item.id === detail.id); page = job ? <JobDetail data={data} role={role} job={job} onBack={() => setDetail({ type: "project", id: job.projectId })} onUpdated={() => void refresh(role)} /> : <SubcontractorPages data={data} view="overview" mutate={mutate} />; }
  else page = view === "pay-requests" ? <SubPayRequests data={data} mutate={mutate} /> : view === "notifications" ? <NotificationsPage data={data} mutate={mutate} /> : <SubcontractorPages data={data} view={view} mutate={mutate} onOpenProject={(project) => setDetail({ type: "project", id: project.id })} onOpenJob={(job) => setDetail({ type: "job", id: job.id })} />;

  if (mustChangePassword) return <PasswordScreen role={role} onDone={() => { setMustChangePassword(false); void refresh(role); }} />;

  return (
    <Layout role={role} viewerName={data.viewer.name} view={view} onViewChange={(nextView) => { setDetail(null); setView(nextView); }} onRoleChange={changeRole} onSignOut={() => { clearSessionToken(); setPreview(null); setSessionRole(null); setData(null); }}>
      {sessionRole === "admin" && <section className="preview-bar"><strong>{previewRole ? `ADMIN PREVIEW MODE — Viewing as ${previewAccounts.find((user) => user.id === previewUserId)?.name || previewRole}` : "Administrator controls"}</strong><label>View as <select value={previewRole || "admin"} onChange={(event) => changeRole(event.target.value as Role)}><option value="admin">Admin</option><option value="client">Client</option><option value="subcontractor">Subcontractor</option></select></label>{previewRole && <label>Account <select value={previewUserId} onChange={(event) => changeRole(previewRole, event.target.value)}>{previewAccounts.filter((user) => user.role === previewRole && user.active).map((user) => <option key={user.id} value={user.id}>{user.name}{user.company ? ` · ${user.company}` : ""}</option>)}</select></label>} {previewRole && <button className="button button-small" onClick={() => changeRole("admin")}>Exit preview</button>}</section>}
      {role === "project_manager" && <section className="read-only-banner"><strong>PROJECT MANAGER — VIEW ACCESS</strong><span>You can view all operational information and create a new project; existing records cannot be changed.</span></section>}
      <div className={role === "project_manager" ? "read-only-view" : ""}>{page}</div>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.type === "success" ? <CheckCircle2 /> : <AlertCircle />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X /></button></div>)}
      </div>
    </Layout>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: (role: Role, mustChange: boolean) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(""); try { const result = await api.login(String(form.get("email")), String(form.get("password"))); setSessionToken(result.token, result.user.role); onSuccess(result.user.role, result.user.mustChangePassword); } catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in."); } finally { setBusy(false); } };
  return <main className="boot-screen"><span className="brand-mark">B</span><h1>BullShark Connected</h1><p>Secure operations portal</p><form className="login-form" onSubmit={submit}><label>Email<input name="email" type="email" required autoComplete="username" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary button-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><small>New accounts: use the temporary password provided by your administrator.</small></form></main>;
}
function PasswordScreen({ role, onDone }: { role: Role; onDone: () => void }) { const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get("password")); if (password !== form.get("confirm")) return setError("Passwords do not match."); setBusy(true); try { await api.changePassword(password, role); onDone(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update password."); } finally { setBusy(false); } }; return <main className="boot-screen"><LockKeyhole size={32}/><h1>Create a new password</h1><p>Your temporary password cannot be used again after this step.</p><form className="login-form" onSubmit={submit}><label>New password<input name="password" type="password" minLength={10} required /></label><label>Confirm password<input name="confirm" type="password" minLength={10} required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary button-full" disabled={busy}>Save secure password</button></form></main>; }
