import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PortalData } from "../src/types.js";
import { seedData } from "./seed.js";
import { hashPassword, temporaryPassword } from "./security.js";

export interface DataStore {
  read(): Promise<PortalData>;
  update<T>(mutator: (data: PortalData) => T | Promise<T>): Promise<T>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class JsonDataStore implements DataStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read() {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as PortalData;
      if (await migrate(data)) await this.persist(data);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(seedData);
      return clone(seedData);
    }
  }

  async update<T>(mutator: (data: PortalData) => T | Promise<T>) {
    const operation = this.queue.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.persist(data);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async persist(data: PortalData) {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp`;
    await writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await rename(tempPath, this.path);
  }
}

export class MemoryDataStore implements DataStore {
  private data: PortalData;

  constructor(data: PortalData = seedData) {
    this.data = clone(data);
  }

  async read() {
    await migrate(this.data);
    return clone(this.data);
  }

  async update<T>(mutator: (data: PortalData) => T | Promise<T>) {
    const next = clone(this.data);
    await migrate(next);
    const result = await mutator(next);
    this.data = next;
    return result;
  }
}

/** Adds new collections and accounts without altering existing projects, jobs, or contracts. */
async function migrate(data: PortalData) {
  let changed = false;
  for (const key of ["files", "payRequests", "potentialJobs", "bids", "messages", "notifications", "yardageRows", "concreteSuppliers"] as const) {
    if (!data[key]) { (data as unknown as Record<string, unknown>)[key] = []; changed = true; }
  }
  if (!data.users) {
    const passwordHash = await hashPassword(temporaryPassword);
    data.users = [
      { id: "admin-1", role: "admin", name: "Marcella Johnson", email: "marcella@vipersteel.us", active: true, mustChangePassword: true, passwordHash, projectIds: [], jobIds: [], notificationPreferences: {} },
      ...data.clients.map((client) => ({ id: client.id, role: "client" as const, name: client.name, email: client.email, company: client.company, active: true, mustChangePassword: true, passwordHash, projectIds: data.projects.filter((project) => project.clientId === client.id).map((project) => project.id), jobIds: [], notificationPreferences: {} })),
      ...data.contractors.map((contractor) => ({ id: contractor.id, role: "subcontractor" as const, name: contractor.name, email: contractor.email, phone: contractor.phone, company: contractor.company, trade: contractor.trade, active: true, mustChangePassword: true, passwordHash, projectIds: data.jobs.filter((job) => job.contractorId === contractor.id).map((job) => job.projectId), jobIds: data.jobs.filter((job) => job.contractorId === contractor.id).map((job) => job.id), notificationPreferences: {} })),
    ];
    changed = true;
  }
  return changed;
}
