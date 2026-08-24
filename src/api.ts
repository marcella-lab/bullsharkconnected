import type { BootstrapPayload, Role } from "./types";

export const viewerIds: Record<Role, string> = {
  admin: "admin-1",
  client: "client-1",
  subcontractor: "contractor-1",
};

let authToken = localStorage.getItem("bullshark-session") || "";
let preview: { role: Role; userId?: string } | null = null;
export const setSessionToken = (token: string) => { authToken = token; localStorage.setItem("bullshark-session", token); };
export const clearSessionToken = () => { authToken = ""; localStorage.removeItem("bullshark-session"); };
export const setPreview = (value: { role: Role; userId?: string } | null) => { preview = value; };

async function request<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
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
  mutate: <T>(path: string, role: Role, method: "POST" | "PATCH", data?: unknown) =>
    request<T>(path, role, { method, body: data === undefined ? undefined : JSON.stringify(data) }),
  downloadContract: async (contractId: string, contractNumber: string, role: Role) => {
    const response = await fetch(`/api/contracts/${contractId}/pdf`, {
      headers: { "x-user-role": role, "x-user-id": viewerIds[role] },
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
};
