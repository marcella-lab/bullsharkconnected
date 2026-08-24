import { AlertCircle, CheckCircle2, LoaderCircle, LockKeyhole, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AdminAudit,
  AdminContracts,
  AdminInterests,
  AdminOverview,
  AdminProjects,
  AdminSchedule,
  AdminSettings,
} from "./AdminPages";
import { api, clearSessionToken, setPreview, setSessionToken } from "./api";
import { Layout } from "./Layout";
import { AdminPayRequests, AdminUsers, NotificationsPage, SubPayRequests } from "./OperationsPages";
import { ClientPages, SubcontractorPages } from "./RolePages";
import { YardagePage } from "./YardagePage";
import type { BootstrapPayload, Role } from "./types";

type Toast = { id: number; type: "success" | "error"; message: string };

export function App() {
  const [role, setRole] = useState<Role>("admin");
  const [view, setView] = useState("overview");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sessionRole, setSessionRole] = useState<Role | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [previewRole, setPreviewRole] = useState<Role | null>(null);

  const notify = useCallback((type: Toast["type"], message: string) => {
    const toast = { id: Date.now(), type, message };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 4500);
  }, []);

  const refresh = useCallback(async (activeRole: Role) => {
    try {
      const next = await api.bootstrap(activeRole);
      setData(next);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load the portal.");
    }
  }, []);

  useEffect(() => { if (sessionRole) { setData(null); void refresh(role); } }, [role, refresh, sessionRole]);

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

  const changeRole = (nextRole: Role) => {
    if (sessionRole !== "admin") return;
    if (nextRole === "admin") { setPreview(null); setPreviewRole(null); }
    else { setPreview({ role: nextRole }); setPreviewRole(nextRole); }
    setRole(nextRole);
    setView("overview");
  };

  if (!sessionRole) return <LoginScreen onSuccess={(nextRole, change) => { setRole(nextRole); setSessionRole(nextRole); setMustChangePassword(change); }} />;
  if (!data && !error) return <div className="boot-screen"><span className="brand-mark">B</span><LoaderCircle className="spin" /><p>Connecting operations…</p></div>;
  if (!data) return <div className="boot-screen error-screen"><AlertCircle /><h1>Portal unavailable</h1><p>{error}</p><button className="button button-primary" onClick={() => void refresh(role)}>Try again</button></div>;

  let page;
  if (role === "admin" || role === "project_manager") {
    if (view === "projects") page = <AdminProjects data={data} mutate={mutate} />;
    else if (view === "yardage") page = <YardagePage data={data} mutate={mutate} />;
    else if (view === "schedule") page = <AdminSchedule data={data} mutate={mutate} />;
    else if (view === "contracts") page = <AdminContracts data={data} mutate={mutate} />;
    else if (view === "interests") page = <AdminInterests data={data} />;
    else if (view === "potential") page = <AdminInterests data={data} />;
    else if (view === "users") page = <AdminUsers data={data} mutate={mutate} />;
    else if (view === "pay-requests") page = <AdminPayRequests data={data} mutate={mutate} />;
    else if (view === "notifications") page = <NotificationsPage data={data} mutate={mutate} />;
    else if (view === "settings") page = <AdminSettings data={data} mutate={mutate} />;
    else if (view === "audit") page = <AdminAudit data={data} />;
    else page = <AdminOverview data={data} onView={setView} />;
  } else if (role === "client") page = view === "notifications" ? <NotificationsPage data={data} mutate={mutate} /> : <ClientPages data={data} view={view} />;
  else page = view === "pay-requests" ? <SubPayRequests data={data} mutate={mutate} /> : view === "notifications" ? <NotificationsPage data={data} mutate={mutate} /> : <SubcontractorPages data={data} view={view} mutate={mutate} />;

  if (mustChangePassword) return <PasswordScreen role={role} onDone={() => { setMustChangePassword(false); void refresh(role); }} />;

  return (
    <Layout role={role} viewerName={data.viewer.name} view={view} onViewChange={setView} onRoleChange={changeRole} onSignOut={() => { clearSessionToken(); setPreview(null); setSessionRole(null); setData(null); }}>
      {sessionRole === "admin" && <section className="preview-bar"><strong>{previewRole ? `ADMIN PREVIEW MODE — Viewing as ${previewRole}` : "Administrator controls"}</strong><label>View as <select value={previewRole || "admin"} onChange={(event) => changeRole(event.target.value as Role)}><option value="admin">Admin</option><option value="client">Client</option><option value="subcontractor">Subcontractor</option></select></label>{previewRole && <button className="button button-small" onClick={() => changeRole("admin")}>Exit preview</button>}</section>}
      {role === "project_manager" && <section className="read-only-banner"><strong>PROJECT MANAGER — READ-ONLY ACCESS</strong><span>You can view all operational information, but cannot make changes.</span></section>}
      <div className={role === "project_manager" ? "read-only-view" : ""}>{page}</div>
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.type === "success" ? <CheckCircle2 /> : <AlertCircle />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X /></button></div>)}
      </div>
    </Layout>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: (role: Role, mustChange: boolean) => void }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(""); try { const result = await api.login(String(form.get("email")), String(form.get("password"))); setSessionToken(result.token); onSuccess(result.user.role, result.user.mustChangePassword); } catch (e) { setError(e instanceof Error ? e.message : "Unable to sign in."); } finally { setBusy(false); } };
  return <main className="boot-screen"><span className="brand-mark">B</span><h1>BullShark Connected</h1><p>Secure operations portal</p><form className="login-form" onSubmit={submit}><label>Email<input name="email" type="email" required autoComplete="username" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary button-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button><small>New accounts: use the temporary password provided by your administrator.</small></form></main>;
}
function PasswordScreen({ role, onDone }: { role: Role; onDone: () => void }) { const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const password = String(form.get("password")); if (password !== form.get("confirm")) return setError("Passwords do not match."); setBusy(true); try { await api.changePassword(password, role); onDone(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update password."); } finally { setBusy(false); } }; return <main className="boot-screen"><LockKeyhole size={32}/><h1>Create a new password</h1><p>Your temporary password cannot be used again after this step.</p><form className="login-form" onSubmit={submit}><label>New password<input name="password" type="password" minLength={10} required /></label><label>Confirm password<input name="confirm" type="password" minLength={10} required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary button-full" disabled={busy}>Save secure password</button></form></main>; }
