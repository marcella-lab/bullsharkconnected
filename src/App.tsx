import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  AdminAudit,
  AdminContracts,
  AdminInterests,
  AdminOverview,
  AdminProjects,
  AdminSchedule,
  AdminSettings,
} from "./AdminPages";
import { api } from "./api";
import { Layout } from "./Layout";
import { ClientPages, SubcontractorPages } from "./RolePages";
import type { BootstrapPayload, Role } from "./types";

type Toast = { id: number; type: "success" | "error"; message: string };

export function App() {
  const [role, setRole] = useState<Role>("admin");
  const [view, setView] = useState("overview");
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

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

  useEffect(() => { setData(null); void refresh(role); }, [role, refresh]);

  const mutate = useCallback(async <T,>(path: string, method: "POST" | "PATCH", body?: unknown) => {
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
    setRole(nextRole);
    setView("overview");
  };

  if (!data && !error) return <div className="boot-screen"><span className="brand-mark">B</span><LoaderCircle className="spin" /><p>Connecting operations…</p></div>;
  if (!data) return <div className="boot-screen error-screen"><AlertCircle /><h1>Portal unavailable</h1><p>{error}</p><button className="button button-primary" onClick={() => void refresh(role)}>Try again</button></div>;

  let page;
  if (role === "admin") {
    if (view === "projects") page = <AdminProjects data={data} mutate={mutate} />;
    else if (view === "schedule") page = <AdminSchedule data={data} mutate={mutate} />;
    else if (view === "contracts") page = <AdminContracts data={data} mutate={mutate} />;
    else if (view === "interests") page = <AdminInterests data={data} />;
    else if (view === "settings") page = <AdminSettings data={data} mutate={mutate} />;
    else if (view === "audit") page = <AdminAudit data={data} />;
    else page = <AdminOverview data={data} onView={setView} />;
  } else if (role === "client") page = <ClientPages data={data} view={view} />;
  else page = <SubcontractorPages data={data} view={view} mutate={mutate} />;

  return (
    <Layout role={role} viewerName={data.viewer.name} view={view} onViewChange={setView} onRoleChange={changeRole}>
      {page}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => <div className={`toast toast-${toast.type}`} key={toast.id}>{toast.type === "success" ? <CheckCircle2 /> : <AlertCircle />}<span>{toast.message}</span><button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}><X /></button></div>)}
      </div>
    </Layout>
  );
}
