import { resolve, sep } from "node:path";
import { access, mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AuditEntry, BootstrapPayload, Contract, Job, PortalData, Role, PortalUser, PayRequestStatus, FileVisibility, YardageRow } from "../src/types.js";
import { ConfiguredEsignService, contractStorage, generateContractPdf, type ContractContext, type EsignService } from "./contracts.js";
import type { DataStore } from "./store.js";
import { hashPassword, sessionToken, temporaryPassword, verifyPassword } from "./security.js";

declare global {
  namespace Express {
    interface Request {
      viewer: { role: Role; id: string };
      actor?: { role: Role; id: string };
    }
  }
}

const roles = ["admin", "project_manager", "client", "subcontractor"] as const;
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const isoNow = () => new Date().toISOString();
const fileStorage = process.env.FILE_STORAGE_DIR || resolve(process.cwd(), "data", "uploads");

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

const audit = (data: PortalData, action: string, detail: string, role: Role = "admin") => {
  const entry: AuditEntry = { id: id("audit"), action, detail, actorRole: role, createdAt: isoNow() };
  data.audit.unshift(entry);
  data.audit = data.audit.slice(0, 100);
};

const notify = (data: PortalData, userId: string, type: string, title: string, detail: string, href: string, priority: "normal" | "high" = "normal") => {
  data.notifications!.unshift({ id: id("notice"), userId, type, title, detail, href, priority, createdAt: isoNow() });
};

const userById = (data: PortalData, idValue: string) => data.users!.find((user) => user.id === idValue);
const parsePair = (value: string, label: string) => { const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)$/i); if (!match) throw Object.assign(new Error(label === "footer size" ? "Enter footer size as Width x Depth (example: 18x24)." : "Enter dimensions as Length x Width (example: 60x40)."), { status: 400 }); return [Number(match[1]), Number(match[2])] as const; };
const calculateYardage = (input: { dimensions: string; thickness: number; footers: string; additionalConcreteYardage?: number; wasteOverageYardage?: number }) => {
  const [length, width] = parsePair(input.dimensions, "dimensions"); const [footerWidth, footerDepth] = parsePair(input.footers, "footer size");
  if (!(input.thickness > 0)) throw Object.assign(new Error("Thickness must be greater than zero."), { status: 400 });
  const slabSquareFeet = length * width; const slabYardage = (length * width * input.thickness) / 324; const footerYardage = ((2 * (length + width)) * (footerWidth / 12) * (footerDepth / 12)) / 27; const totalYardage = slabYardage + footerYardage;
  const additionalConcreteYardage = input.additionalConcreteYardage || 0; const wasteOverageYardage = input.wasteOverageYardage || 0;
  return { length, width, footerWidth, footerDepth, slabSquareFeet, slabYardage, padYardage: slabYardage, footerYardage, totalYardage, additionalConcreteYardage, wasteOverageYardage, finalOrderYardage: totalYardage + additionalConcreteYardage + wasteOverageYardage };
};

const requireRole = (...allowed: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!allowed.includes(req.viewer.role)) return res.status(403).json({ message: "You do not have permission to perform this action." });
  next();
};

const contractContext = (data: PortalData, contract: Contract): ContractContext => {
  const job = data.jobs.find((item) => item.id === contract.jobId);
  const project = data.projects.find((item) => item.id === contract.projectId);
  const contractor = data.contractors.find((item) => item.id === contract.contractorId);
  if (!job || !project || !contractor) throw new Error("The contract references missing project data.");
  return { contract, job, project, contractor, settings: data.settings };
};

const filteredData = (data: PortalData, role: Role, viewerId: string): PortalData => {
  if (role === "admin" || role === "project_manager") return data;
  if (role === "client") {
    const projects = data.projects.filter((project) => project.clientId === viewerId || data.jobs.some((job) => job.projectId === project.id && job.clientId === viewerId));
    const projectIds = new Set(projects.map((project) => project.id));
    return {
      ...data,
      settings: { ...data.settings, contractTemplate: "" },
      clients: data.clients.filter((client) => client.id === viewerId),
      contractors: [],
      projects,
      jobs: data.jobs.filter((job) => projectIds.has(job.projectId)),
      contracts: [],
      interests: [],
      audit: [],
      users: data.users?.filter((user) => user.id === viewerId).map(({ passwordHash, ...user }) => ({ ...user, passwordHash: "" })),
      files: data.files?.filter((file) => projectIds.has(file.projectId) && ["client", "client_and_assigned_subcontractor", "project_access"].includes(file.visibility)),
      payRequests: [], potentialJobs: [], bids: [],
      yardageRows: [], concreteSuppliers: [],
      messages: data.messages?.filter((message) => message.recipientIds.includes(viewerId) || message.senderId === viewerId),
      notifications: data.notifications?.filter((notice) => notice.userId === viewerId),
    };
  }
  const assigned = data.jobs.filter((job) => job.contractorId === viewerId);
  const potential = data.jobs.filter((job) => job.interestOpen);
  const jobs = [...new Map([...assigned, ...potential].map((job) => [job.id, job])).values()];
  const projectIds = new Set(jobs.map((job) => job.projectId));
  return {
    ...data,
    settings: { ...data.settings, contractTemplate: "" },
    clients: [],
    contractors: data.contractors.filter((contractor) => contractor.id === viewerId),
    projects: data.projects.filter((project) => projectIds.has(project.id)),
    jobs,
    contracts: data.contracts.filter((contract) => contract.contractorId === viewerId),
    interests: data.interests.filter((interest) => interest.contractorId === viewerId),
    audit: [],
    users: data.users?.filter((user) => user.id === viewerId).map(({ passwordHash, ...user }) => ({ ...user, passwordHash: "" })),
    files: data.files?.filter((file) => projectIds.has(file.projectId) && (file.visibility === "project_access" || (file.visibility !== "admin" && file.jobIds.some((jobId) => assigned.some((job) => job.id === jobId))))),
    payRequests: data.payRequests?.filter((item) => item.subcontractorId === viewerId),
    potentialJobs: data.potentialJobs?.filter((item) => item.status === "open" && (item.visibleTo === "all" || (item.visibleTo === "trade" && data.contractors.find((contractor) => contractor.id === viewerId)?.trade.toLowerCase() === item.trade.toLowerCase()) || item.contractorIds.includes(viewerId))),
    bids: data.bids?.filter((item) => item.contractorId === viewerId),
    yardageRows: [], concreteSuppliers: [],
    messages: data.messages?.filter((message) => message.recipientIds.includes(viewerId) || message.senderId === viewerId),
    notifications: data.notifications?.filter((notice) => notice.userId === viewerId),
  };
};

export function createApp(store: DataStore, esign: EsignService = new ConfiguredEsignService()) {
  const app = express();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(asyncRoute(async (req, res, next) => {
    // The React application and its static assets must remain publicly readable;
    // authentication is enforced on every API route below.
    if (!req.path.startsWith("/api/")) return next();
    if (req.path === "/api/health" || req.path === "/api/auth/login") return next();
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const session = token && sessions.get(token);
    if (session && session.expiresAt > Date.now()) {
      const data = await store.read();
      const user = userById(data, session.userId);
      if (!user || !user.active) return res.status(401).json({ message: "Your account is unavailable." });
      req.viewer = { role: user.role, id: user.id };
      req.actor = { ...req.viewer };
      const previewRole = z.enum(roles).safeParse(req.header("x-preview-role"));
      if (user.role === "admin" && previewRole.success && previewRole.data !== "admin") {
        const requestedId = req.header("x-preview-user-id");
        const target = data.users!.find((candidate) => candidate.id === requestedId && candidate.role === previewRole.data && candidate.active)
          || data.users!.find((candidate) => candidate.role === previewRole.data && candidate.active);
        if (!target) return res.status(404).json({ message: `No active ${previewRole.data} is available for preview.` });
        req.viewer = { role: target.role, id: target.id };
      }
      return next();
    }
    // Header identities remain available for automated tests and local demo only. Production requires a session.
    if (process.env.NODE_ENV === "production") return res.status(401).json({ message: "Please sign in to continue." });
    const parsed = z.enum(roles).safeParse(req.header("x-user-role") || "client");
    if (!parsed.success) return res.status(400).json({ message: "Unknown portal role." });
    req.viewer = {
      role: parsed.data,
      id: req.header("x-user-id") || (parsed.data === "client" ? "client-1" : parsed.data === "subcontractor" ? "contractor-1" : "admin-1"),
    };
    next();
  }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth/login", asyncRoute(async (req, res) => {
    const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const key = req.ip || input.email.toLowerCase(); const state = attempts.get(key);
    if (state && state.resetAt > Date.now() && state.count >= 8) return res.status(429).json({ message: "Too many sign-in attempts. Try again in 15 minutes." });
    const data = await store.read(); const user = data.users!.find((item) => item.email.toLowerCase() === input.email.toLowerCase());
    if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash))) {
      attempts.set(key, { count: (state && state.resetAt > Date.now() ? state.count : 0) + 1, resetAt: Date.now() + 15 * 60_000 });
      return res.status(401).json({ message: "Invalid email or password." });
    }
    attempts.delete(key); user.lastLoginAt = isoNow(); await store.update((next) => { const current = userById(next, user.id)!; current.lastLoginAt = user.lastLoginAt; });
    const token = sessionToken(); sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60_000 });
    res.json({ token, user: { id: user.id, role: user.role, name: user.name, mustChangePassword: user.mustChangePassword } });
  }));

  app.post("/api/auth/change-password", asyncRoute(async (req, res) => {
    const input = z.object({ password: z.string().min(10).max(200) }).parse(req.body);
    await store.update(async (data) => { const user = userById(data, req.viewer.id)!; user.passwordHash = await hashPassword(input.password); user.mustChangePassword = false; audit(data, "Password changed", `${user.email} completed password setup.`, user.role); });
    res.json({ ok: true });
  }));

  app.get("/api/bootstrap", asyncRoute(async (req, res) => {
    const all = await store.read();
    const data = filteredData(all, req.viewer.role, req.viewer.id);
    const name = req.viewer.role === "admin" || req.viewer.role === "project_manager"
      ? "Marcella Johnson"
      : data.clients[0]?.name || data.contractors[0]?.name || "Portal user";
    const payload: BootstrapPayload = { ...data, users: data.users?.map(({ passwordHash, ...user }) => ({ ...user, passwordHash: "" })), viewer: { ...req.viewer, name } };
    res.json(payload);
  }));

  const userSchema = z.object({ role: z.enum(roles), name: z.string().trim().min(2), firstName: z.string().trim().max(80).optional(), lastName: z.string().trim().max(80).optional(), email: z.string().email(), phone: z.string().trim().max(40).optional(), company: z.string().trim().max(120).optional(), trade: z.string().trim().max(120).optional(), projectIds: z.array(z.string()).default([]), jobIds: z.array(z.string()).default([]), active: z.boolean().default(true) });
  const publicUser = ({ passwordHash, ...user }: PortalUser) => user;
  app.get("/api/users", requireRole("admin", "project_manager"), asyncRoute(async (_req, res) => {
    const data = await store.read();
    res.json((data.users || []).map(publicUser));
  }));
  app.post("/api/users", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = userSchema.parse(req.body); const user = await store.update(async (data) => {
      if (data.users!.some((item) => item.email.toLowerCase() === input.email.toLowerCase())) throw Object.assign(new Error("That email is already in use."), { status: 409 });
      if (input.role === "admin" || input.role === "project_manager") { input.projectIds = []; input.jobIds = []; }
      if (input.role === "client") input.jobIds = [];
      if (input.jobIds.some((jobId) => !data.jobs.some((job) => job.id === jobId && input.projectIds.includes(job.projectId)))) throw Object.assign(new Error("Each assigned job must belong to an assigned project."), { status: 400 });
      const item: PortalUser = { id: id("user"), ...input, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, notificationPreferences: {} };
      data.users!.push(item); audit(data, "User created", `${item.email} added as ${item.role}.`); notify(data, item.id, "account", "Your BullShark account is ready", "Sign in with your temporary password and create a new password.", "overview", "high"); return item;
    }); res.status(201).json({ ...user, temporaryPassword: temporaryPassword });
  }));
  app.patch("/api/users/:userId", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = userSchema.partial().parse(req.body); const user = await store.update((data) => { const item = userById(data, String(req.params.userId)); if (!item) throw Object.assign(new Error("User not found."), { status: 404 }); Object.assign(item, input); audit(data, "User updated", `${item.email} profile, role, or access changed.`); return item; }); res.json(user);
  }));
  app.post("/api/users/:userId/reset-password", requireRole("admin"), asyncRoute(async (req, res) => {
    const user = await store.update(async (data) => { const item = userById(data, String(req.params.userId)); if (!item) throw Object.assign(new Error("User not found."), { status: 404 }); item.passwordHash = await hashPassword(temporaryPassword); item.mustChangePassword = true; audit(data, "Password reset", `${item.email} reset to temporary-password mode.`); notify(data, item.id, "security", "Password reset required", "An administrator reset your password. Sign in and create a new password.", "overview", "high"); return item; }); res.json({ id: user.id, temporaryPassword });
  }));

  const yardageSchema = z.object({
    status: z.enum(["ACTIVE", "INACTIVE", "POTENTIAL", "COMPLETED"]),
    state: z.string().trim().max(8).default(""),
    concreteCompany: z.string().trim().max(160).default(""),
    client: z.string().trim().min(1).max(200),
    projectId: z.string().optional().or(z.literal("")),
    dimensions: z.string().trim().min(3).max(40),
    thickness: z.coerce.number().positive().max(48),
    footers: z.string().trim().min(3).max(40),
    concreteCost: z.coerce.number().nonnegative().default(0),
    subCost: z.coerce.number().nonnegative().default(0),
    contractCost: z.coerce.number().nonnegative().default(0),
    additionalCosts: z.coerce.number().nonnegative().default(0),
    additionalConcreteYardage: z.coerce.number().nonnegative().default(0),
    wasteOverageYardage: z.coerce.number().nonnegative().default(0),
    notes: z.string().max(3000).optional(),
  });
  const supplierSchema = z.object({ company: z.string().trim().min(1).max(160), contactName: z.string().trim().max(120).optional(), phone: z.string().trim().max(50).optional(), email: z.string().email().optional().or(z.literal("")), state: z.string().trim().max(8).optional(), notes: z.string().trim().max(2000).optional() });
  const makeYardageRow = (input: z.infer<typeof yardageSchema>, actorId: string, existing?: YardageRow): YardageRow => {
    const calc = calculateYardage(input);
    const now = isoNow();
    return { id: existing?.id || id("yardage"), ...input, projectId: input.projectId || undefined, ...calc, createdAt: existing?.createdAt || now, updatedAt: now, createdBy: existing?.createdBy || actorId, updatedBy: actorId };
  };
  app.get("/api/yardage", requireRole("admin"), asyncRoute(async (_req, res) => { const data = await store.read(); res.json({ rows: data.yardageRows || [], suppliers: data.concreteSuppliers || [] }); }));
  app.post("/api/yardage", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = yardageSchema.parse(req.body); const row = await store.update((data) => { if (input.projectId && !data.projects.some((project) => project.id === input.projectId)) throw Object.assign(new Error("Selected project was not found."), { status: 404 }); const item = makeYardageRow(input, req.viewer.id); data.yardageRows!.unshift(item); audit(data, "Yardage row created", `${item.client} · ${item.totalYardage.toFixed(2)} CY.`); return item; }); res.status(201).json(row);
  }));
  app.patch("/api/yardage/:rowId", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = yardageSchema.partial().parse(req.body); const row = await store.update((data) => { const existing = data.yardageRows!.find((item) => item.id === req.params.rowId); if (!existing) throw Object.assign(new Error("Calculator row not found."), { status: 404 }); const merged = yardageSchema.parse({ ...existing, ...input }); if (merged.projectId && !data.projects.some((project) => project.id === merged.projectId)) throw Object.assign(new Error("Selected project was not found."), { status: 404 }); const item = makeYardageRow(merged, req.viewer.id, existing); Object.assign(existing, item); audit(data, "Yardage row updated", `${existing.client} calculator values changed.`); return existing; }); res.json(row);
  }));
  app.delete("/api/yardage/:rowId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.yardageRows!.findIndex((item) => item.id === req.params.rowId); if (index < 0) throw Object.assign(new Error("Calculator row not found."), { status: 404 }); const [removed] = data.yardageRows!.splice(index, 1); audit(data, "Yardage row deleted", `${removed.client} calculator row deleted.`); }); res.json({ ok: true }); }));
  app.post("/api/yardage/suppliers", requireRole("admin"), asyncRoute(async (req, res) => { const input = supplierSchema.parse(req.body); const supplier = await store.update((data) => { const existing = data.concreteSuppliers!.find((item) => item.company.toLowerCase() === input.company.toLowerCase()); const item = { id: existing?.id || id("supplier"), ...input, email: input.email || undefined }; if (existing) Object.assign(existing, item); else data.concreteSuppliers!.unshift(item); audit(data, existing ? "Concrete supplier updated" : "Concrete supplier created", item.company); return existing || item; }); res.status(201).json(supplier); }));

  const uploadSchema = z.object({ projectId: z.string(), jobIds: z.array(z.string()).default([]), name: z.string().min(1).max(200), mimeType: z.string().min(1), contentBase64: z.string().min(1), category: z.enum(["Plans", "Engineering", "Contract", "Estimate", "Permit", "Survey", "Photos", "Invoice", "Change Order", "Specifications", "Other"]).default("Other"), description: z.string().max(1000).default(""), captureDate: z.string().date().optional().or(z.literal("")), geoLatitude: z.coerce.number().min(-90).max(90).optional(), geoLongitude: z.coerce.number().min(-180).max(180).optional(), visibility: z.enum(["admin", "client", "assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"] as const) });
  const canProject = (data: PortalData, user: PortalUser | undefined, projectId: string) => user?.role === "admin" || user?.role === "project_manager" || Boolean(user?.projectIds.includes(projectId)) || data.projects.some((project) => project.id === projectId && project.clientId === user?.id);
  app.post("/api/files", asyncRoute(async (req, res) => {
    const input = uploadSchema.parse(req.body); const all = await store.read(); const user = userById(all, req.viewer.id); if (!canProject(all, user, input.projectId) || (req.viewer.role === "subcontractor" && input.jobIds.some((jobId) => !user?.jobIds.includes(jobId)))) return res.status(403).json({ message: "You cannot upload files for this work." });
    const allowed = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv", "application/zip", "application/x-zip-compressed"];
    if (!allowed.includes(input.mimeType)) return res.status(400).json({ message: "Unsupported file type." }); const bytes = Buffer.from(input.contentBase64, "base64"); if (bytes.length > 12 * 1024 * 1024) return res.status(400).json({ message: "Files must be 12 MB or smaller." });
    const file = await store.update(async (data) => { const fileId = id("file"); await mkdir(fileStorage, { recursive: true }); const path = resolve(fileStorage, fileId); await writeFile(path, bytes); const item = { id: fileId, projectId: input.projectId, jobIds: input.jobIds, name: input.name, mimeType: input.mimeType, size: bytes.length, path, category: input.category, description: input.description, captureDate: input.captureDate || undefined, capturedToday: input.captureDate === isoNow().slice(0, 10), geoLatitude: input.geoLatitude, geoLongitude: input.geoLongitude, visibility: input.visibility as FileVisibility, uploadedBy: req.viewer.id, createdAt: isoNow() }; data.files!.unshift(item); audit(data, "File uploaded", `${item.name} uploaded${item.geoLatitude !== undefined ? " with GPS location" : ""}.`, req.viewer.role); return item; }); res.status(201).json(file);
  }));
  app.patch("/api/files/:fileId", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ name: z.string().min(1).max(200).optional(), description: z.string().max(1000).optional(), category: z.string().optional(), visibility: z.enum(["admin", "client", "assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"] as const).optional(), jobIds: z.array(z.string()).optional() }).parse(req.body); const file = await store.update((data) => { const item = data.files!.find((entry) => entry.id === String(req.params.fileId)); if (!item) throw Object.assign(new Error("File not found."), { status: 404 }); Object.assign(item, input); audit(data, "File updated", `${item.name} file metadata or job associations changed.`); return item; }); res.json(file); }));
  app.get("/api/files/:fileId/download", asyncRoute(async (req, res) => { const data = await store.read(); const file = data.files!.find((item) => item.id === req.params.fileId); const user = userById(data, req.viewer.id); if (!file || !canProject(data, user, file.projectId) || (req.viewer.role === "subcontractor" && file.visibility !== "project_access" && !file.jobIds.some((job) => user?.jobIds.includes(job))) || (req.viewer.role === "client" && !["client", "client_and_assigned_subcontractor", "project_access"].includes(file.visibility))) return res.status(403).json({ message: "You do not have access to this file." }); res.download(file.path, file.name); }));

  const payRequestSchema = z.object({ projectId: z.string(), jobId: z.string(), amountRequested: z.coerce.number().positive(), invoiceNumber: z.string().min(1), invoiceDate: z.string().date(), description: z.string().max(3000).default(""), invoice: z.object({ name: z.string().min(1), mimeType: z.string(), contentBase64: z.string().min(1) }), attachments: z.array(z.object({ name: z.string(), mimeType: z.string(), contentBase64: z.string() })).default([]) });
  app.post("/api/pay-requests", requireRole("subcontractor"), asyncRoute(async (req, res) => {
    const input = payRequestSchema.parse(req.body); const request = await store.update(async (data) => { const user = userById(data, req.viewer.id)!; if (!user.jobIds.includes(input.jobId) || !user.projectIds.includes(input.projectId)) throw Object.assign(new Error("This job is not assigned to you."), { status: 403 }); await mkdir(fileStorage, { recursive: true }); const save = async (file: { name: string; mimeType: string; contentBase64: string }) => { const fileId = id("attachment"); const path = resolve(fileStorage, fileId); const bytes = Buffer.from(file.contentBase64, "base64"); await writeFile(path, bytes); return { id: fileId, name: file.name, mimeType: file.mimeType, path, size: bytes.length }; }; const invoice = await save(input.invoice); const attachments = await Promise.all(input.attachments.map(save)); const item = { id: id("pay"), projectId: input.projectId, jobId: input.jobId, subcontractorId: user.id, subcontractorName: user.name, company: user.company || "", amountRequested: input.amountRequested, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, description: input.description, invoice, attachments, status: "submitted" as PayRequestStatus, readByAdmin: false, createdAt: isoNow(), updatedAt: isoNow(), activity: [{ id: id("event"), action: "Submitted", actorId: user.id, actorName: user.name, createdAt: isoNow() }] }; data.payRequests!.unshift(item); data.users!.filter((admin) => admin.role === "admin" && admin.active).forEach((admin) => notify(data, admin.id, "pay_request", "New pay request", `${user.company || user.name} submitted ${input.invoiceNumber}.`, "pay-requests", "high")); audit(data, "Pay request submitted", `${user.name} submitted ${input.invoiceNumber}.`, "subcontractor"); return item; }); res.status(201).json(request);
  }));
  app.patch("/api/pay-requests/:payId", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ status: z.enum(["submitted", "under_review", "approved", "partially_approved", "payment_processing", "paid", "rejected", "needs_revision"]), approvedAmount: z.coerce.number().nonnegative().optional(), adminNotes: z.string().max(3000).optional(), paymentDate: z.string().date().optional(), paymentReference: z.string().max(120).optional() }).parse(req.body); const result = await store.update((data) => { const item = data.payRequests!.find((entry) => entry.id === req.params.payId); if (!item) throw Object.assign(new Error("Pay request not found."), { status: 404 }); Object.assign(item, input, { updatedAt: isoNow(), readByAdmin: true }); const actor = userById(data, req.viewer.id)!; item.activity.push({ id: id("event"), action: input.status.replaceAll("_", " "), actorId: actor.id, actorName: actor.name, createdAt: isoNow(), note: input.adminNotes }); notify(data, item.subcontractorId, "pay_request", "Pay request updated", `Your ${item.invoiceNumber} request is now ${input.status.replaceAll("_", " ")}.`, "pay-requests", "high"); audit(data, "Pay request updated", `${item.invoiceNumber} marked ${input.status}.`); return item; }); res.json(result); }));

  const potentialSchema = z.object({ projectId: z.string(), title: z.string().min(2), trade: z.string().min(2), scope: z.string().min(4), location: z.string().min(2), estimatedStartDate: z.string().date().optional().or(z.literal("")), estimatedCompletionDate: z.string().date().optional().or(z.literal("")), bidDue: z.string().date().optional().or(z.literal("")), budget: z.coerce.number().nonnegative().optional(), notes: z.string().max(3000).optional(), visibleTo: z.enum(["all", "trade", "specific"]), contractorIds: z.array(z.string()).default([]), fileIds: z.array(z.string()).default([]) });
  app.post("/api/potential-jobs", requireRole("admin"), asyncRoute(async (req, res) => { const input = potentialSchema.parse(req.body); const potential = await store.update((data) => { const item = { id: id("potential"), ...input, estimatedStartDate: input.estimatedStartDate || undefined, estimatedCompletionDate: input.estimatedCompletionDate || undefined, bidDue: input.bidDue || undefined, status: "open" as const, createdAt: isoNow() }; data.potentialJobs!.unshift(item); const recipients = data.users!.filter((user) => user.role === "subcontractor" && user.active && (item.visibleTo === "all" || (item.visibleTo === "trade" && user.trade?.toLowerCase() === item.trade.toLowerCase()) || item.contractorIds.includes(user.id))); recipients.forEach((user) => notify(data, user.id, "potential_job", "New potential job", `${item.title} is available to review.`, "potential", "high")); audit(data, "Potential job posted", item.title); return item; }); res.status(201).json(potential); }));
  app.post("/api/potential-jobs/:potentialId/bids", requireRole("subcontractor"), asyncRoute(async (req, res) => { const input = z.object({ amount: z.coerce.number().positive(), duration: z.string().min(1), proposedStartDate: z.string().date().optional().or(z.literal("")), comments: z.string().max(3000).optional(), fileIds: z.array(z.string()).default([]), status: z.enum(["interested", "submitted"]).default("submitted") }).parse(req.body); const bid = await store.update((data) => { const potential = data.potentialJobs!.find((item) => item.id === req.params.potentialId && item.status === "open"); const user = userById(data, req.viewer.id)!; if (!potential || !(potential.visibleTo === "all" || (potential.visibleTo === "trade" && potential.trade.toLowerCase() === user.trade?.toLowerCase()) || potential.contractorIds.includes(user.id))) throw Object.assign(new Error("This opportunity is unavailable."), { status: 403 }); const existing = data.bids!.find((item) => item.potentialJobId === potential.id && item.contractorId === user.id); const item = existing || { id: id("bid"), potentialJobId: potential.id, contractorId: user.id, contractorName: user.company || user.name, amount: input.amount, duration: input.duration, proposedStartDate: input.proposedStartDate || undefined, comments: input.comments, fileIds: input.fileIds, status: input.status, createdAt: isoNow(), updatedAt: isoNow() }; Object.assign(item, input, { proposedStartDate: input.proposedStartDate || undefined, updatedAt: isoNow() }); if (!existing) data.bids!.unshift(item); data.users!.filter((admin) => admin.role === "admin" && admin.active).forEach((admin) => notify(data, admin.id, "bid", `${input.status === "interested" ? "Interest" : "Bid"} received`, `${user.company || user.name} responded to ${potential.title}.`, "potential", "high")); audit(data, existing ? "Bid updated" : "Bid submitted", `${user.name} responded to ${potential.title}.`, "subcontractor"); return item; }); res.status(201).json(bid); }));
  app.post("/api/potential-jobs/:potentialId/award", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ bidId: z.string() }).parse(req.body); const result = await store.update((data) => { const potential = data.potentialJobs!.find((item) => item.id === req.params.potentialId); const bid = data.bids!.find((item) => item.id === input.bidId && item.potentialJobId === potential?.id); if (!potential || !bid) throw Object.assign(new Error("Potential job or bid not found."), { status: 404 }); const project = data.projects.find((item) => item.id === potential.projectId)!; const contractor = userById(data, bid.contractorId)!; const job: Job = { id: id("job"), projectId: project.id, number: `${project.number}-J${String(data.jobs.filter((item) => item.projectId === project.id).length + 1).padStart(2, "0")}`, title: potential.title, scope: potential.scope, location: potential.location, price: bid.amount, stage: "Planned", progress: 0, status: "planned", contractorId: contractor.id, contractorName: contractor.company || contractor.name, interestOpen: false }; data.jobs.push(job); contractor.projectIds = [...new Set([...contractor.projectIds, project.id])]; contractor.jobIds = [...new Set([...contractor.jobIds, job.id])]; potential.status = "awarded"; bid.status = "selected"; notify(data, contractor.id, "award", "You were awarded a job", `${potential.title} is now an assigned job.`, "jobs", "high"); audit(data, "Job awarded", `${potential.title} awarded to ${contractor.name}.`); return { potential, job }; }); res.json(result); }));

  app.get("/api/notifications", asyncRoute(async (req, res) => { const data = await store.read(); res.json(data.notifications!.filter((item) => item.userId === req.viewer.id)); }));
  app.post("/api/notifications/read", asyncRoute(async (req, res) => { const input = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(req.body); await store.update((data) => data.notifications!.filter((item) => item.userId === req.viewer.id && (input.all || input.ids?.includes(item.id))).forEach((item) => { item.readAt = isoNow(); })); res.json({ ok: true }); }));
  app.post("/api/messages", asyncRoute(async (req, res) => { const input = z.object({ contextType: z.enum(["project", "job", "potential_job", "pay_request"]), contextId: z.string(), recipientIds: z.array(z.string()).min(1), body: z.string().min(1).max(5000), attachmentIds: z.array(z.string()).default([]) }).parse(req.body); const message = await store.update((data) => { const item = { id: id("message"), ...input, senderId: req.viewer.id, readBy: [req.viewer.id], createdAt: isoNow() }; data.messages!.unshift(item); data.users!.filter((user) => input.recipientIds.includes(user.id)).forEach((user) => notify(data, user.id, "message", "New message", input.body.slice(0, 100), "messages", "normal")); audit(data, "Message sent", `Message sent in ${input.contextType}.`, req.viewer.role); return item; }); res.status(201).json(message); }));

  const projectSchema = z.object({
    name: z.string().trim().min(2),
    address: z.string().trim().min(2),
    clientId: z.string().min(1),
    manager: z.string().trim().min(2),
    budget: z.coerce.number().nonnegative(),
    startDate: z.string().date(),
    targetDate: z.string().date(),
  });

  app.post("/api/projects", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = projectSchema.parse(req.body);
    const project = await store.update((data) => {
      const client = data.clients.find((item) => item.id === input.clientId);
      if (!client) throw Object.assign(new Error("Client not found."), { status: 404 });
      const nextNumber = String(data.projects.length + 1).padStart(4, "0");
      const value: PortalData["projects"][number] = {
        id: id("project"),
        number: `BS-${new Date().getFullYear()}-${nextNumber}`,
        name: input.name,
        address: input.address,
        clientId: client.id,
        clientName: client.name,
        manager: input.manager,
        budget: input.budget,
        progress: 0,
        currentStage: data.settings.stages[0]?.name || "Planned",
        startDate: input.startDate,
        targetDate: input.targetDate,
        status: "active",
      };
      data.projects.push(value);
      audit(data, "Project created", `${value.number} · ${value.name}`);
      return value;
    });
    res.status(201).json(project);
  }));

  const jobSchema = z.object({
    title: z.string().trim().min(2),
    scope: z.string().trim().min(4),
    location: z.string().trim().min(2),
    price: z.coerce.number().nonnegative(),
    stage: z.string().trim().min(2),
    scheduleStart: z.string().date().optional().or(z.literal("")),
    scheduleEnd: z.string().date().optional().or(z.literal("")),
    interestOpen: z.boolean().default(false),
    bidDue: z.string().date().optional().or(z.literal("")),
    clientId: z.string().min(1),
    contractorId: z.string().optional().or(z.literal("")),
  });

  app.post("/api/projects/:projectId/jobs", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = jobSchema.parse(req.body);
    const job = await store.update((data) => {
      const project = data.projects.find((item) => item.id === req.params.projectId);
      if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
      const siblingCount = data.jobs.filter((item) => item.projectId === project.id).length; const client = data.clients.find((item) => item.id === input.clientId); const contractor = input.contractorId ? data.contractors.find((item) => item.id === input.contractorId) : undefined;
      if (!client) throw Object.assign(new Error("Client not found."), { status: 404 }); if (input.contractorId && !contractor) throw Object.assign(new Error("Subcontractor not found."), { status: 404 });
      const value: Job = {
        id: id("job"),
        projectId: project.id,
        number: `${project.number}-J${String(siblingCount + 1).padStart(2, "0")}`,
        title: input.title,
        scope: input.scope,
        location: input.location,
        price: input.price,
        stage: input.stage,
        progress: 0,
        status: input.scheduleStart ? "scheduled" : "planned",
        scheduleStart: input.scheduleStart || undefined,
        scheduleEnd: input.scheduleEnd || undefined,
        interestOpen: input.interestOpen,
        bidDue: input.bidDue || undefined,
        clientId: client.id,
        clientName: client.name,
        contractorId: contractor?.id,
        contractorName: contractor?.company,
      };
      data.jobs.push(value);
      audit(data, "Job created", `${value.number} added under ${project.name}`);
      return value;
    });
    res.status(201).json(job);
  }));

  const jobEditSchema = z.object({ title: z.string().trim().min(2), scope: z.string().trim().min(4), location: z.string().trim().min(2), price: z.coerce.number().nonnegative(), stage: z.string().trim().min(2), clientId: z.string().min(1), contractorId: z.string().optional().or(z.literal("")) });
  app.patch("/api/jobs/:jobId", requireRole("admin"), asyncRoute(async (req, res) => { const input = jobEditSchema.parse(req.body); const job = await store.update((data) => { const item = data.jobs.find((candidate) => candidate.id === req.params.jobId); const client = data.clients.find((candidate) => candidate.id === input.clientId); const contractor = input.contractorId ? data.contractors.find((candidate) => candidate.id === input.contractorId) : undefined; if (!item) throw Object.assign(new Error("Job not found."), { status: 404 }); if (!client) throw Object.assign(new Error("Client not found."), { status: 404 }); if (input.contractorId && !contractor) throw Object.assign(new Error("Subcontractor not found."), { status: 404 }); Object.assign(item, input, { contractorId: contractor?.id, contractorName: contractor?.company, clientId: client.id, clientName: client.name }); const clientUser = userById(data, client.id); if (clientUser) clientUser.projectIds = [...new Set([...clientUser.projectIds, item.projectId])]; if (contractor) { const contractorUser = userById(data, contractor.id); if (contractorUser) { contractorUser.projectIds = [...new Set([...contractorUser.projectIds, item.projectId])]; contractorUser.jobIds = [...new Set([...contractorUser.jobIds, item.id])]; } } audit(data, "Job assignment updated", `${item.number} assigned to client ${client.name}${contractor ? ` and ${contractor.company}` : ""}.`); return item; }); res.json(job); }));
  app.delete("/api/jobs/:jobId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.jobs.findIndex((item) => item.id === req.params.jobId); if (index < 0) throw Object.assign(new Error("Job not found."), { status: 404 }); const [job] = data.jobs.splice(index, 1); data.contracts = data.contracts.filter((contract) => contract.jobId !== job.id); data.files = data.files?.map((file) => ({ ...file, jobIds: file.jobIds.filter((jobId) => jobId !== job.id) })); data.users?.forEach((user) => { user.jobIds = user.jobIds.filter((jobId) => jobId !== job.id); }); audit(data, "Job deleted", `${job.number} · ${job.title} deleted.`); }); res.json({ ok: true }); }));
  app.delete("/api/projects/:projectId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.projects.findIndex((item) => item.id === req.params.projectId); if (index < 0) throw Object.assign(new Error("Project not found."), { status: 404 }); const [project] = data.projects.splice(index, 1); const jobIds = new Set(data.jobs.filter((job) => job.projectId === project.id).map((job) => job.id)); data.jobs = data.jobs.filter((job) => job.projectId !== project.id); data.contracts = data.contracts.filter((contract) => contract.projectId !== project.id); data.files = data.files?.filter((file) => file.projectId !== project.id); data.users?.forEach((user) => { user.projectIds = user.projectIds.filter((projectId) => projectId !== project.id); user.jobIds = user.jobIds.filter((jobId) => !jobIds.has(jobId)); }); audit(data, "Project deleted", `${project.number} · ${project.name} and its jobs deleted.`); }); res.json({ ok: true }); }));

  const scheduleSchema = z.object({
    scheduleStart: z.string().date(),
    scheduleEnd: z.string().date(),
  }).refine((value) => value.scheduleEnd >= value.scheduleStart, { message: "End date must be on or after the start date." });

  app.post("/api/jobs/:jobId/schedule", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = scheduleSchema.parse(req.body);
    const job = await store.update((data) => {
      const item = data.jobs.find((candidate) => candidate.id === req.params.jobId);
      if (!item) throw Object.assign(new Error("Job not found."), { status: 404 });
      Object.assign(item, input, { status: item.progress > 0 ? "in_progress" : "scheduled" });
      audit(data, "Job scheduled", `${item.number} · ${input.scheduleStart} to ${input.scheduleEnd}`);
      return item;
    });
    res.json(job);
  }));

  const progressSchema = z.object({
    stage: z.string().trim().min(2),
    progress: z.coerce.number().min(0).max(100),
    status: z.enum(["planned", "scheduled", "in_progress", "blocked", "complete"]),
  });

  app.patch("/api/jobs/:jobId/progress", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = progressSchema.parse(req.body);
    const job = await store.update((data) => {
      const item = data.jobs.find((candidate) => candidate.id === req.params.jobId);
      if (!item) throw Object.assign(new Error("Job not found."), { status: 404 });
      Object.assign(item, input);
      const project = data.projects.find((candidate) => candidate.id === item.projectId);
      if (project) {
        const jobs = data.jobs.filter((candidate) => candidate.projectId === project.id);
        project.progress = Math.round(jobs.reduce((total, candidate) => total + candidate.progress, 0) / jobs.length);
        const furthest = [...jobs].sort((a, b) => b.progress - a.progress)[0];
        project.currentStage = furthest?.stage || project.currentStage;
        if (jobs.every((candidate) => candidate.status === "complete")) project.status = "complete";
      }
      audit(data, "Progress updated", `${item.number} moved to ${item.stage} at ${item.progress}%`);
      return item;
    });
    res.json(job);
  }));

  const assignmentSchema = z.object({
    contractorId: z.string().min(1),
    contractNumber: z.string().trim().min(3),
    price: z.coerce.number().positive(),
    paymentTerms: z.string().trim().min(3),
    notes: z.string().trim().max(2000).default(""),
    sendNow: z.boolean().default(true),
  });

  app.post("/api/jobs/:jobId/assign", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = assignmentSchema.parse(req.body);
    const result = await store.update(async (data) => {
      const job = data.jobs.find((item) => item.id === req.params.jobId);
      const contractor = data.contractors.find((item) => item.id === input.contractorId);
      const project = job && data.projects.find((item) => item.id === job.projectId);
      if (!job || !project) throw Object.assign(new Error("Job not found."), { status: 404 });
      if (!contractor) throw Object.assign(new Error("Subcontractor not found."), { status: 404 });
      job.contractorId = contractor.id;
      job.contractorName = contractor.company;
      job.interestOpen = false;
      job.status = job.scheduleStart ? "scheduled" : "planned";

      const now = isoNow();
      const contract: Contract = {
        id: id("contract"),
        jobId: job.id,
        projectId: project.id,
        contractorId: contractor.id,
        contractNumber: input.contractNumber,
        price: input.price,
        paymentTerms: input.paymentTerms,
        notes: input.notes,
        status: "draft",
        pdfPath: "",
        createdAt: now,
        updatedAt: now,
      };
      contract.pdfPath = await generateContractPdf({ contract, contractor, job, project, settings: data.settings });
      data.contracts.unshift(contract);
      let warning: string | undefined;
      if (input.sendNow) {
        try {
          const envelope = await esign.send(contractContext(data, contract));
          contract.envelopeId = envelope.envelopeId;
          contract.signingUrl = envelope.signingUrl;
          contract.status = envelope.status;
        } catch (error) {
          warning = error instanceof Error ? error.message : "The e-signature provider could not send the envelope.";
          contract.status = "failed";
          contract.deliveryError = warning;
        }
      }
      audit(data, "Subcontractor assigned", `${contractor.company} assigned to ${job.number}; contract ${contract.contractNumber} generated.`);
      return { job, contract, warning };
    });
    res.status(201).json(result);
  }));

  const contractEditSchema = z.object({
    contractNumber: z.string().trim().min(3),
    price: z.coerce.number().positive(),
    paymentTerms: z.string().trim().min(3),
    notes: z.string().trim().max(2000),
  });

  app.patch("/api/contracts/:contractId", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = contractEditSchema.parse(req.body);
    const contract = await store.update(async (data) => {
      const item = data.contracts.find((candidate) => candidate.id === req.params.contractId);
      if (!item) throw Object.assign(new Error("Contract not found."), { status: 404 });
      if (item.status === "signed") throw Object.assign(new Error("Signed contracts cannot be edited."), { status: 409 });
      Object.assign(item, input, { status: "draft", updatedAt: isoNow(), envelopeId: undefined, signingUrl: undefined, deliveryError: undefined });
      item.pdfPath = await generateContractPdf(contractContext(data, item));
      audit(data, "Contract updated", `${item.contractNumber} regenerated by admin.`);
      return item;
    });
    res.json(contract);
  }));

  app.post("/api/contracts/:contractId/send", requireRole("admin"), asyncRoute(async (req, res) => {
    const result = await store.update(async (data) => {
      const item = data.contracts.find((candidate) => candidate.id === req.params.contractId);
      if (!item) throw Object.assign(new Error("Contract not found."), { status: 404 });
      try {
        const envelope = await esign.send(contractContext(data, item));
        item.envelopeId = envelope.envelopeId;
        item.signingUrl = envelope.signingUrl;
        item.status = envelope.status;
        item.deliveryError = undefined;
        item.updatedAt = isoNow();
        audit(data, "Contract sent", `${item.contractNumber} sent through ${data.settings.esignProvider}.`);
        return { contract: item };
      } catch (error) {
        item.status = "failed";
        item.deliveryError = error instanceof Error ? error.message : "Unable to send contract.";
        item.updatedAt = isoNow();
        return { contract: item, warning: item.deliveryError };
      }
    });
    res.json(result);
  }));

  app.post("/api/contracts/:contractId/sign", requireRole("admin", "subcontractor"), asyncRoute(async (req, res) => {
    const input = z.object({ signerName: z.string().trim().min(2).max(120), signerTitle: z.string().trim().min(2).max(120), accepted: z.literal(true) }).parse(req.body);
    const contract = await store.update(async (data) => {
      const item = data.contracts.find((candidate) => candidate.id === String(req.params.contractId));
      if (!item) throw Object.assign(new Error("Contract not found."), { status: 404 });
      if (req.viewer.role === "subcontractor" && item.contractorId !== req.viewer.id) throw Object.assign(new Error("You can only sign your own contracts."), { status: 403 });
      if (item.status === "signed") throw Object.assign(new Error("This contract has already been signed."), { status: 409 });
      item.signerName = input.signerName; item.signerTitle = input.signerTitle; item.signedAt = isoNow(); item.status = "signed"; item.updatedAt = item.signedAt;
      item.pdfPath = await generateContractPdf(contractContext(data, item));
      audit(data, "Contract signed", `${item.contractNumber} signed by ${input.signerName}${req.viewer.role === "admin" ? " (admin action)" : ""}.`, req.viewer.role);
      data.users?.filter((user) => user.role === "admin" && user.active).forEach((user) => notify(data, user.id, "contract", "Contract signed", `${item.contractNumber} was signed by ${input.signerName}.`, "contracts", "high"));
      return item;
    });
    res.json(contract);
  }));

  app.delete("/api/contracts/:contractId", requireRole("admin"), asyncRoute(async (req, res) => {
    await store.update(async (data) => {
      const index = data.contracts.findIndex((item) => item.id === String(req.params.contractId));
      if (index < 0) throw Object.assign(new Error("Contract not found."), { status: 404 });
      const [contract] = data.contracts.splice(index, 1);
      const safeRoot = resolve(contractStorage) + sep; const path = resolve(contract.pdfPath);
      if (path.startsWith(safeRoot)) await unlink(path).catch(() => undefined);
      audit(data, "Contract deleted", `${contract.contractNumber} removed by admin.`);
    });
    res.status(204).end();
  }));

  app.get("/api/contracts/:contractId/pdf", requireRole("admin", "project_manager", "subcontractor"), asyncRoute(async (req, res) => {
    const data = await store.read();
    const contract = data.contracts.find((item) => item.id === req.params.contractId);
    if (!contract) return res.status(404).json({ message: "Contract not found." });
    if (req.viewer.role === "subcontractor" && contract.contractorId !== req.viewer.id) {
      return res.status(403).json({ message: "You do not have access to this contract." });
    }
    // Older saved records may predate the persistent contract volume. Rebuild their
    // PDF on demand from the stored contract, project, job, and template data.
    try { await access(contract.pdfPath); }
    catch {
      await store.update(async (next) => {
        const item = next.contracts.find((candidate) => candidate.id === contract.id)!;
        item.pdfPath = await generateContractPdf(contractContext(next, item));
        item.updatedAt = isoNow();
      });
      const refreshed = await store.read();
      const item = refreshed.contracts.find((candidate) => candidate.id === contract.id)!;
      contract.pdfPath = item.pdfPath;
    }
    const safeRoot = resolve(contractStorage) + sep;
    const path = resolve(contract.pdfPath);
    if (!path.startsWith(safeRoot)) return res.status(400).json({ message: "Invalid contract file." });
    res.download(path, `${contract.contractNumber}.pdf`);
  }));

  const interestSchema = z.object({
    phone: z.string().trim().min(7).max(30),
    availability: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(1000).default(""),
  });

  app.post("/api/jobs/:jobId/interests", requireRole("subcontractor"), asyncRoute(async (req, res) => {
    const input = interestSchema.parse(req.body);
    const result = await store.update((data) => {
      const job = data.jobs.find((item) => item.id === req.params.jobId && item.interestOpen);
      const contractor = data.contractors.find((item) => item.id === req.viewer.id);
      if (!job) throw Object.assign(new Error("This job is no longer accepting interest."), { status: 404 });
      if (!contractor) throw Object.assign(new Error("Subcontractor profile not found."), { status: 404 });
      const existing = data.interests.find((item) => item.jobId === job.id && item.contractorId === contractor.id);
      if (existing) return { submission: existing, duplicate: true };
      const submission: PortalData["interests"][number] = {
        id: id("interest"),
        jobId: job.id,
        contractorId: contractor.id,
        contractorName: contractor.name,
        contractorEmail: contractor.email,
        phone: input.phone,
        availability: input.availability,
        notes: input.notes,
        status: "new",
        createdAt: isoNow(),
      };
      data.interests.unshift(submission);
      audit(data, "Job interest received", `${contractor.company} is interested in ${job.number}.`, "subcontractor");
      return { submission, duplicate: false };
    });
    res.status(result.duplicate ? 200 : 201).json({
      ...result,
      message: result.duplicate
        ? "Your interest was already submitted. BullShark will follow up with you."
        : "Interest submitted. BullShark will review your availability and follow up with you.",
    });
  }));

  const settingsSchema = z.object({
    companyName: z.string().trim().min(2),
    supportEmail: z.string().email(),
    senderName: z.string().trim().min(2),
    contractPrefix: z.string().trim().min(2),
    paymentTerms: z.string().trim().min(3),
    esignProvider: z.enum(["demo", "docusign"]),
    contractTemplate: z.string().trim().min(100),
    stages: z.array(z.object({ name: z.string().trim().min(2), percent: z.coerce.number().min(0).max(100) })).min(1),
  });

  app.patch("/api/settings", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const settings = await store.update((data) => {
      data.settings = input;
      audit(data, "Global settings updated", "Company, stage, or contract-template settings changed.");
      return data.settings;
    });
    res.json(settings);
  }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues[0]?.message || "Invalid request.", issues: error.issues });
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (status >= 500) console.error(error);
    res.status(status).json({ message });
  });

  return app;
}
