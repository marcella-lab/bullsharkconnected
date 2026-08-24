import type { BootstrapPayload, Role } from "./types";

export const viewerIds: Record<Role, string> = {
  admin: "admin-1",
  client: "client-1",
  subcontractor: "contractor-1",
};

async function request<T>(path: string, role: Role, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-user-role": role,
      "x-user-id": viewerIds[role],
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || "The request could not be completed.");
  return body as T;
}

export const api = {
  bootstrap: (role: Role) => request<BootstrapPayload>("/api/bootstrap", role),
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
};
