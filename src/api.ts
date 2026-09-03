import type { BootstrapPayload, Role } from "./types";

export const viewerIds: Record<Role, string> = {
  admin: "admin-1",
  project_manager: "project-manager-1",
  client: "client-1",
  subcontractor: "contractor-1",
};

let authToken = localStorage.getItem("bullshark-session") || "";
let preview: { role: Role; userId?: string } | null = null;
export const savedSessionRole = (): Role | null => { const role = localStorage.getItem("bullshark-session-role"); return role === "admin" || role === "project_manager" || role === "client" || role === "subcontractor" ? role : null; };
export const setSessionToken = (token: string, role: Role) => { authToken = token; localStorage.setItem("bullshark-session", token); localStorage.setItem("bullshark-session-role", role); };
export const clearSessionToken = () => { authToken = ""; localStorage.removeItem("bullshark-session"); localStorage.removeItem("bullshark-session-role"); };
export const setPreview = (value: { role: Role; userId?: string } | null) => { preview = value; };
const resourceHeaders = (role: Role) => ({
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : { "x-user-role": role, "x-user-id": viewerIds[role] }),
  ...(preview ? { "x-preview-role": preview.role, ...(preview.userId ? { "x-preview-user-id": preview.userId } : {}) } : {}),
});
const openAuthenticatedBlob = async (path: string, role: Role) => {
  // iOS blocks a tab opened after an awaited request, so reserve it immediately.
  const target = window.open("about:blank", "_blank");
  try {
    const response = await fetch(path, { headers: resourceHeaders(role) });
    if (!response.ok) throw new Error("This invoice file could not be opened.");
    const url = URL.createObjectURL(await response.blob());
    if (target) target.location.href = url;
    else window.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    target?.close();
    throw error;
  }
};

async function request<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : { "x-user-role": role, "x-user-id": viewerIds[role] }),
      ...(preview ? { "x-preview-role": preview.role, ...(preview.userId ? { "x-preview-user-id": preview.userId } : {}) } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "The request could not be completed.");
  return body as T;
}

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: { id: string; role: Role; name: string; mustChangePassword: boolean } }>("/api/auth/login", "client", { method: "POST", body: JSON.stringify({ email, password }) }),
  changePassword: (password: string, role: Role) => request<{ ok: boolean }>("/api/auth/change-password", role, { method: "POST", body: JSON.stringify({ password }) }),
  bootstrap: (role: Role) => request<BootstrapPayload>("/api/bootstrap", role),
  get: <T,>(path: string, role: Role) => request<T>(path, role),
  mutate: async <T,>(path: string, role: Role, method: "POST" | "PATCH" | "DELETE", data?: unknown) => {
    const result = await request<T>(path, role, { method, body: data === undefined ? undefined : JSON.stringify(data) });
    // Some detail cards call the API directly instead of the app-level mutation
    // helper. Notify the app so every successful write reloads the shared data.
    window.dispatchEvent(new Event("bullshark:data-saved"));
    return result;
  },
  downloadContract: async (contractId: string, contractNumber: string, role: Role) => {
    const response = await fetch(`/api/contracts/${contractId}/pdf`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : { "x-user-role": role, "x-user-id": viewerIds[role] },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || "Unable to download the contract.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${contractNumber}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  },
  downloadFile: async (fileId: string, name: string, role: Role) => {
    const response = await fetch(`/api/files/${fileId}/download`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : { "x-user-role": role, "x-user-id": viewerIds[role] } });
    if (!response.ok) throw new Error("You do not have access to this file.");
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  },
  previewFile: async (fileId: string, role: Role) => {
    const response = await fetch(`/api/files/${fileId}/preview`, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : { "x-user-role": role, "x-user-id": viewerIds[role] } });
    if (!response.ok) throw new Error("You do not have access to this file.");
    return URL.createObjectURL(await response.blob());
  },
  openFile: (fileId: string, role: Role) => openAuthenticatedBlob(`/api/files/${fileId}/preview`, role),
  openContract: (contractId: string, role: Role) => openAuthenticatedBlob(`/api/contracts/${contractId}/pdf`, role),
  openPayRequestFile: (payId: string, fileId: string, role: Role) => openAuthenticatedBlob(`/api/pay-requests/${payId}/files/${fileId}/preview`, role),
};
