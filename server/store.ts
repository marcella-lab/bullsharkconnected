import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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

  constructor(private readonly path: string, private readonly allowSeedOnMissing = true) {}

  async read() {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8")) as PortalData;
      if (await migrate(data)) await this.persist(data);
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!this.allowSeedOnMissing) {
        throw Object.assign(new Error("The live portal data file is unavailable. Refusing to create blank replacement data."), { status: 503 });
      }
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
    // Keep a recoverable copy before every write. A user or password action
    // can never be allowed to turn unavailable data into a blank dataset.
    try {
      const backupDirectory = join(dirname(this.path), "backups");
      await mkdir(backupDirectory, { recursive: true });
      const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
      await copyFile(this.path, join(backupDirectory, `${basename(this.path)}.${safeTime}.bak`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
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
  const settingsDefaults = { companyAddress: "", companyPhone: "", companyWebsite: "", defaultClientMessage: "", defaultSubcontractorMessage: "", scheduleDays: 14, weekendWorkAllowed: false, notificationRules: {}, clientPortal: { schedule: true, files: true, photos: true, progress: true }, subcontractorPortal: { sharedFiles: true, schedule: true, projectAddress: true, payRequests: true } };
  for (const [key, value] of Object.entries(settingsDefaults)) if ((data.settings as unknown as Record<string, unknown>)[key] === undefined) { (data.settings as unknown as Record<string, unknown>)[key] = value; changed = true; }
  for (const key of ["files", "payRequests", "clientInvoices", "projectInvoiceLogs", "projectExpenses", "potentialJobs", "bids", "messages", "notifications", "yardageRows", "concreteSuppliers"] as const) {
    if (!data[key]) { (data as unknown as Record<string, unknown>)[key] = []; changed = true; }
  }
  for (const row of data.yardageRows || []) {
    if (row.slabYardage === undefined || row.finalOrderYardage === undefined) {
      const parse = (text: string) => text.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i)?.slice(1).map(Number) || [0, 0];
      const [length, width] = parse(row.dimensions); const [footerWidth, footerDepth] = parse(row.footers);
      const slabSquareFeet = length * width; const slabYardage = (slabSquareFeet * row.thickness) / 324;
      const footerYardage = (2 * (length + width) * (footerWidth / 12) * (footerDepth / 12)) / 27;
      Object.assign(row, { length, width, footerWidth, footerDepth, slabSquareFeet, slabYardage, padYardage: slabYardage, footerYardage, totalYardage: slabYardage + footerYardage, additionalConcreteYardage: 0, wasteOverageYardage: 0, finalOrderYardage: slabYardage + footerYardage }); changed = true;
    }
  }
  for (const [index, project] of data.projects.entries()) {
    if (!project.milestones) { project.milestones = []; changed = true; }
    if (project.displayOrder === undefined) { project.displayOrder = index; changed = true; }
    const client = data.clients.find((item) => item.id === project.clientId);
    // Preserve the contact information already shown on existing projects,
    // while giving every project its own editable contact record from now on.
    if (project.clientContactName === undefined) { project.clientContactName = client?.name || project.clientName; changed = true; }
    if (project.clientContactEmail === undefined) { project.clientContactEmail = client?.email || ""; changed = true; }
    if (project.clientContactPhone === undefined) { project.clientContactPhone = client?.phone || ""; changed = true; }
  }
  for (const job of data.jobs) {
    if (!job.clientId) {
      const project = data.projects.find((item) => item.id === job.projectId);
      if (project) { job.clientId = project.clientId; job.clientName = project.clientName; changed = true; }
    }
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
  // Older client accounts were stored only in users. Keep a matching client
  // record so they appear in the assignment dropdown without being recreated.
  for (const user of data.users.filter((item) => item.role === "client")) {
    if (!data.clients.some((client) => client.id === user.id || client.email.toLowerCase() === user.email.toLowerCase())) {
      data.clients.push({ id: user.id, name: user.name, email: user.email, phone: user.phone, company: user.company });
      changed = true;
    }
  }
  // Remove gallery records for photos that no longer have a file on disk. This
  // keeps users from seeing a permanent "Loading photo" tile after an old upload.
  const availableFiles = [];
  for (const file of data.files || []) {
    if (!file.mimeType.startsWith("image/")) { availableFiles.push(file); continue; }
    try { await access(file.path); availableFiles.push(file); } catch { changed = true; }
  }
  if (availableFiles.length !== (data.files || []).length) data.files = availableFiles;

  const demoPasswordHash = await hashPassword(temporaryPassword);
  const demoClientId = "demo-client-1";
  const demoContractorId = "demo-contractor-1";
  if (!data.clients.some((client) => client.id === demoClientId)) { data.clients.push({ id: demoClientId, name: "Demo Client", email: "demo.client@bullsharkconnected.org", company: "Demo Client Company" }); changed = true; }
  if (!data.contractors.some((contractor) => contractor.id === demoContractorId)) { data.contractors.push({ id: demoContractorId, name: "Demo Subcontractor", email: "demo.subcontractor@bullsharkconnected.org", phone: "(555) 010-3000", company: "Demo Field Company", trade: "Concrete" }); changed = true; }
  const demoAccounts = [
    { id: demoClientId, role: "client" as const, name: "Demo Client", email: "demo.client@bullsharkconnected.org", company: "Demo Client Company", projectIds: data.projects.slice(0, 1).map((project) => project.id), jobIds: [] },
    { id: "demo-project-manager-1", role: "project_manager" as const, name: "Demo Project Manager", email: "demo.manager@bullsharkconnected.org", company: "BullShark Connected", projectIds: [], jobIds: [] },
    { id: demoContractorId, role: "subcontractor" as const, name: "Demo Subcontractor", email: "demo.subcontractor@bullsharkconnected.org", company: "Demo Field Company", trade: "Concrete", projectIds: data.projects.slice(0, 1).map((project) => project.id), jobIds: data.jobs.slice(0, 1).map((job) => job.id) },
  ];
  for (const account of demoAccounts) if (!data.users.some((user) => user.id === account.id)) { data.users.push({ ...account, active: true, mustChangePassword: true, passwordHash: demoPasswordHash, notificationPreferences: {} }); changed = true; }
  return changed;
}
