import { dirname, resolve, sep } from "node:path";
import { access, mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AuditEntry, BootstrapPayload, Contract, Job, PortalData, Role, PortalUser, PayRequestStatus, FileVisibility, YardageRow } from "../src/types.js";
import { ConfiguredEsignService, contractStorage, generateContractPdf, type ContractContext, type EsignService } from "./contracts.js";
import type { DataStore } from "./store.js";
import { hashPassword, sessionToken, temporaryPassword, verifyPassword } from "./security.js";
import { sendAccountEmail, sendNotificationEmail } from "./email.js";

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
// Keep uploaded files beside the configured data store. On Railway DATA_PATH is
// mounted at /data, so this also places all photos and plans on the persistent volume.
const fileStorage = process.env.FILE_STORAGE_DIR || resolve(dirname(process.env.DATA_PATH || resolve(process.cwd(), "data", "portal.json")), "uploads");

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

const audit = (data: PortalData, action: string, detail: string, role: Role = "admin") => {
  const entry: AuditEntry = { id: id("audit"), action, detail, actorRole: role, createdAt: isoNow() };
  data.audit.unshift(entry);
  data.audit = data.audit.slice(0, 100);
};

const deliverSms = async (recipient: PortalUser, title: string, detail: string, href: string) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !from || !recipient.phone) return;
  const preference = recipient.notificationPreferences?.sms;
  if (preference && !preference.sms) return;
  const appUrl = (process.env.APP_URL || "https://portal.bullsharkconnected.org").replace(/\/$/, "");
  const form = new URLSearchParams({ To: recipient.phone, From: from, Body: `${title}: ${detail}\n${appUrl}/?view=${encodeURIComponent(href)}`.slice(0, 1500) });
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    if (!response.ok) console.error("Twilio SMS delivery failed:", response.status, await response.text());
  } catch (error) { console.error("Twilio SMS delivery error:", error); }
};

const notify = (data: PortalData, userId: string, type: string, title: string, detail: string, href: string, priority: "normal" | "high" = "normal") => {
  const rule = data.settings.notificationRules?.[type];
  if (rule?.inApp !== false) data.notifications!.unshift({ id: id("notice"), userId, type, title, detail, href, priority, createdAt: isoNow() });
  const recipient = data.users?.find((user) => user.id === userId);
  if (recipient?.active && rule?.sms !== false) void deliverSms(recipient, title, detail, href);
  // Account and security notices have a dedicated email containing the temporary password.
  if (recipient?.active && rule?.email === true && type !== "account" && type !== "security") void sendNotificationEmail(recipient, title, detail, href);
};

const notifyJobParticipants = (data: PortalData, job: Job, title: string, detail: string) => {
  new Set([job.clientId, ...subcontractorUsersFor(data, job.contractorId).map((user) => user.id)].filter((value): value is string => Boolean(value))).forEach((userId) => notify(data, userId, "job", title, detail, "jobs", "high"));
};

const canAccessPotentialFile = (data: PortalData, user: PortalUser | undefined, fileId: string) => Boolean(user?.role === "subcontractor" && data.potentialJobs?.some((item) => item.status === "open" && item.fileIds.includes(fileId) && (item.visibleTo === "all" || (item.visibleTo === "trade" && item.trade.toLowerCase() === user.trade?.toLowerCase()) || item.contractorIds.includes(user.id))));

const fileAudienceIncludes = (visibility: FileVisibility, role: Role) => {
  if (role === "admin") return true;
  if (role === "client") return ["client", "client_and_assigned_subcontractor", "project_access"].includes(visibility);
  if (role === "subcontractor") return ["assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"].includes(visibility);
  return visibility === "project_access";
};

const userById = (data: PortalData, idValue: string) => data.users!.find((user) => user.id === idValue);
const subcontractorUsersFor = (data: PortalData, contractorId?: string) => {
  const contractor = data.contractors.find((item) => item.id === contractorId);
  const normalize = (value?: string) => value?.trim().toLowerCase() || "";
  return (data.users || []).filter((user) => user.role === "subcontractor" && (user.id === contractorId || Boolean(contractor && (normalize(user.email) === normalize(contractor.email) || (normalize(user.company) !== "" && normalize(user.company) === normalize(contractor.company))))));
};
const jobIsAssignedTo = (data: PortalData, user: PortalUser | undefined, job: Job) => Boolean(user && (user.jobIds.includes(job.id) || subcontractorUsersFor(data, job.contractorId).some((account) => account.id === user.id)));
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
    const user = userById(data, viewerId);
    const projects = data.projects.filter((project) => project.clientId === viewerId || user?.projectIds.includes(project.id) || data.jobs.some((job) => job.projectId === project.id && job.clientId === viewerId));
    const projectIds = new Set(projects.map((project) => project.id));
    return {
      ...data,
      settings: { ...data.settings, contractTemplate: "" },
      clients: data.clients.filter((client) => client.id === viewerId),
      contractors: [],
      projects: projects.map(({ fieldNotes: _fieldNotes, milestones: _milestones, ...project }) => project),
      jobs: data.jobs.filter((job) => projectIds.has(job.projectId)),
      contracts: [],
      interests: [],
      audit: [],
      users: data.users?.filter((user) => user.id === viewerId).map(({ passwordHash, ...user }) => ({ ...user, passwordHash: "" })),
      files: data.files?.filter((file) => projectIds.has(file.projectId) && fileAudienceIncludes(file.visibility, "client")),
      payRequests: [], clientInvoices: [], projectInvoiceLogs: (data.projectInvoiceLogs || []).filter((item) => projectIds.has(item.projectId)), projectExpenses: [], potentialJobs: [], bids: [],
      yardageRows: (data.yardageRows || []).filter((row) => projectIds.has(row.projectId || "")), concreteSuppliers: [],
      messages: data.messages?.filter((message) => message.recipientIds.includes(viewerId) || message.senderId === viewerId),
      notifications: data.notifications?.filter((notice) => notice.userId === viewerId),
    };
  }
  const viewer = userById(data, viewerId);
  const assigned = data.jobs.filter((job) => jobIsAssignedTo(data, viewer, job));
  const potential = data.jobs.filter((job) => job.interestOpen);
  const visiblePotentialJobs = data.potentialJobs?.filter((item) => item.status === "open" && (item.visibleTo === "all" || (item.visibleTo === "trade" && data.contractors.find((contractor) => contractor.id === viewerId)?.trade.toLowerCase() === item.trade.toLowerCase()) || item.contractorIds.includes(viewerId))) || [];
  const potentialFileIds = new Set(visiblePotentialJobs.flatMap((item) => item.fileIds));
  const potentialAsJobs: Job[] = visiblePotentialJobs.map((item) => ({ id: item.id, projectId: item.projectId, number: "Potential job", title: item.title, scope: item.scope, location: item.location, price: item.budget || 0, stage: "Potential", progress: 0, status: "planned", interestOpen: true, bidDue: item.bidDue }));
  const jobs = [...new Map([...assigned, ...potential, ...potentialAsJobs].map((job) => [job.id, job])).values()];
  const projectIds = new Set(jobs.map((job) => job.projectId));
  return {
    ...data,
    settings: { ...data.settings, contractTemplate: "" },
    clients: [],
    contractors: data.contractors.filter((contractor) => subcontractorUsersFor(data, contractor.id).some((user) => user.id === viewerId)),
    projects: data.projects.filter((project) => projectIds.has(project.id)),
    jobs,
    contracts: data.contracts.filter((contract) => contract.contractorId === viewerId),
    interests: data.interests.filter((interest) => interest.contractorId === viewerId),
    audit: [],
    users: data.users?.filter((user) => user.id === viewerId).map(({ passwordHash, ...user }) => ({ ...user, jobIds: [...new Set([...user.jobIds, ...assigned.map((job) => job.id)])], projectIds: [...new Set([...user.projectIds, ...assigned.map((job) => job.projectId)])], passwordHash: "" })),
    files: data.files?.filter((file) => potentialFileIds.has(file.id) || (projectIds.has(file.projectId) && fileAudienceIncludes(file.visibility, "subcontractor") && (file.visibility === "project_access" || file.jobIds.length === 0 || file.jobIds.some((jobId) => assigned.some((job) => job.id === jobId))))),
    payRequests: data.payRequests?.filter((item) => item.subcontractorId === viewerId), clientInvoices: [], projectInvoiceLogs: (data.projectInvoiceLogs || []).filter((item) => projectIds.has(item.projectId)), projectExpenses: [],
    potentialJobs: visiblePotentialJobs,
    bids: data.bids?.filter((item) => item.contractorId === viewerId),
    yardageRows: (data.yardageRows || []).filter((row) => projectIds.has(row.projectId || "")), concreteSuppliers: [],
    messages: data.messages?.filter((message) => message.recipientIds.includes(viewerId) || message.senderId === viewerId),
    notifications: data.notifications?.filter((notice) => notice.userId === viewerId),
  };
};

export function createApp(store: DataStore, esign: EsignService = new ConfiguredEsignService()) {
  const app = express();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();
  const attempts = new Map<string, { count: number; resetAt: number }>();
  app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173" }));
  app.use(express.json({ limit: "20mb" }));
  // Portal records are edited frequently. Never let a browser or proxy replay
  // an older bootstrap response after a successful save.
  app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"); next(); });
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
    // Use the authenticated account, rather than the first visible client or
    // contractor record, so the sidebar always identifies the signed-in user.
    const name = userById(all, req.viewer.id)?.name || "Portal user";
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
      data.users!.push(item);
      // Client accounts are also client records: project and job assignment pickers
      // are driven by data.clients, so keeping the IDs identical makes new accounts
      // available for assignment immediately.
      if (item.role === "client") data.clients.push({ id: item.id, name: item.name, email: item.email, phone: item.phone, company: item.company });
      audit(data, "User created", `${item.email} added as ${item.role}.`); notify(data, item.id, "account", "Your BullShark account is ready", "Sign in with your temporary password and create a new password.", "overview", "high"); return item;
    });
    const email = await sendAccountEmail(user, "invitation", temporaryPassword);
    await store.update((data) => audit(data, email.sent ? "Invitation email sent" : "Invitation email not sent", `${user.email}: ${email.sent ? "invitation delivered" : email.reason || "delivery unavailable"}.`));
    res.status(201).json({ ...user, temporaryPassword: temporaryPassword, invitationEmailSent: email.sent, invitationEmailNotice: email.reason });
  }));
  app.patch("/api/users/:userId", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = userSchema.partial().parse(req.body); const user = await store.update((data) => { const item = userById(data, String(req.params.userId)); if (!item) throw Object.assign(new Error("User not found."), { status: 404 }); Object.assign(item, input); audit(data, "User updated", `${item.email} profile, role, or access changed.`); return item; }); res.json(user);
  }));
  app.post("/api/users/:userId/reset-password", requireRole("admin"), asyncRoute(async (req, res) => {
    const user = await store.update(async (data) => { const item = userById(data, String(req.params.userId)); if (!item) throw Object.assign(new Error("User not found."), { status: 404 }); item.passwordHash = await hashPassword(temporaryPassword); item.mustChangePassword = true; audit(data, "Password reset", `${item.email} reset to temporary-password mode.`); notify(data, item.id, "security", "Password reset required", "An administrator reset your password. Sign in and create a new password.", "overview", "high"); return item; });
    const email = await sendAccountEmail(user, "password_reset", temporaryPassword);
    await store.update((data) => audit(data, email.sent ? "Password reset email sent" : "Password reset email not sent", `${user.email}: ${email.sent ? "reset instructions delivered" : email.reason || "delivery unavailable"}.`));
    res.json({ id: user.id, temporaryPassword, invitationEmailSent: email.sent, invitationEmailNotice: email.reason });
  }));
  app.delete("/api/users/:userId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const userId = String(req.params.userId); const index = data.users!.findIndex((item) => item.id === userId); if (index < 0) throw Object.assign(new Error("User not found."), { status: 404 }); const user = data.users![index]; if (user.id === req.viewer.id) throw Object.assign(new Error("You cannot delete your own account."), { status: 400 }); if (user.role === "admin" && data.users!.filter((item) => item.role === "admin" && item.active).length <= 1) throw Object.assign(new Error("At least one active Admin account must remain."), { status: 400 }); data.users!.splice(index, 1); audit(data, "User deleted", `${user.email} login access deleted.`); }); res.json({ ok: true }); }));

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
  const supplierSchema = z.object({ company: z.string().trim().min(1).max(160), supplierType: z.string().trim().max(80).optional(), contactName: z.string().trim().max(120).optional(), phone: z.string().trim().max(50).optional(), email: z.string().email().optional().or(z.literal("")), state: z.string().trim().max(8).optional(), notes: z.string().trim().max(2000).optional() });
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
  app.post("/api/yardage/suppliers", requireRole("admin"), asyncRoute(async (req, res) => { const input = supplierSchema.parse(req.body); const supplier = await store.update((data) => { const existing = data.concreteSuppliers!.find((item) => item.company.toLowerCase() === input.company.toLowerCase()); const item = { id: existing?.id || id("supplier"), ...input, email: input.email || undefined }; if (existing) Object.assign(existing, item); else data.concreteSuppliers!.unshift(item); audit(data, existing ? "Supplier updated" : "Supplier created", item.company); return existing || item; }); res.status(201).json(supplier); }));

  const uploadSchema = z.object({ projectId: z.string(), jobIds: z.array(z.string()).default([]), name: z.string().min(1).max(200), mimeType: z.string().min(1), contentBase64: z.string().min(1), category: z.enum(["Plans", "Engineering", "Contract", "Estimate", "Permit", "Survey", "Photos", "Invoice", "Change Order", "Specifications", "Other"]).default("Other"), description: z.string().max(1000).default(""), captureDate: z.string().date().optional().or(z.literal("")), geoLatitude: z.coerce.number().min(-90).max(90).optional(), geoLongitude: z.coerce.number().min(-180).max(180).optional(), visibility: z.enum(["admin", "client", "assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"] as const) });
  const canProject = (data: PortalData, user: PortalUser | undefined, projectId: string) => user?.role === "admin" || user?.role === "project_manager" || Boolean(user?.projectIds.includes(projectId)) || data.projects.some((project) => project.id === projectId && project.clientId === user?.id);
  app.post("/api/files", asyncRoute(async (req, res) => {
    if (req.viewer.role === "project_manager") return res.status(403).json({ message: "Project Managers can view existing project files but cannot change them." });
    const input = uploadSchema.parse(req.body); const all = await store.read(); const user = userById(all, req.viewer.id); if (!canProject(all, user, input.projectId) || (req.viewer.role === "subcontractor" && (!input.jobIds.length || input.jobIds.some((jobId) => !user?.jobIds.includes(jobId)))) || (req.viewer.role === "subcontractor" && !["assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"].includes(input.visibility)) || (req.viewer.role === "client" && !["client", "project_access"].includes(input.visibility))) return res.status(403).json({ message: "You cannot upload files for this work." });
    const bytes = Buffer.from(input.contentBase64, "base64"); if (bytes.length > 12 * 1024 * 1024) return res.status(400).json({ message: "Each file must be 12 MB or smaller." });
    const file = await store.update(async (data) => { const fileId = id("file"); await mkdir(fileStorage, { recursive: true }); const path = resolve(fileStorage, fileId); await writeFile(path, bytes); const item = { id: fileId, projectId: input.projectId, jobIds: input.jobIds, name: input.name, mimeType: input.mimeType, size: bytes.length, path, category: input.category, description: input.description, captureDate: input.captureDate || undefined, capturedToday: input.captureDate === isoNow().slice(0, 10), geoLatitude: input.geoLatitude, geoLongitude: input.geoLongitude, visibility: input.visibility as FileVisibility, uploadedBy: req.viewer.id, createdAt: isoNow() }; data.files!.unshift(item); audit(data, "File uploaded", `${item.name} uploaded${item.geoLatitude !== undefined ? " with GPS location" : ""}.`, req.viewer.role); return item; }); res.status(201).json(file);
  }));
  const canManageFile = (data: PortalData, file: { projectId: string; jobIds: string[]; uploadedBy: string }, viewer: { role: Role; id: string }) => {
    if (viewer.role === "admin") return true;
    const user = userById(data, viewer.id);
    if (!user || file.uploadedBy !== viewer.id || !canProject(data, user, file.projectId)) return false;
    return viewer.role === "client" || (viewer.role === "subcontractor" && file.jobIds.some((jobId) => user.jobIds.includes(jobId)));
  };
  app.patch("/api/files/:fileId", asyncRoute(async (req, res) => { const input = z.object({ name: z.string().min(1).max(200).optional(), description: z.string().max(1000).optional(), category: z.string().optional(), visibility: z.enum(["admin", "client", "assigned_subcontractor", "client_and_assigned_subcontractor", "project_access"] as const).optional(), jobIds: z.array(z.string()).optional() }).parse(req.body); const file = await store.update((data) => { const item = data.files!.find((entry) => entry.id === String(req.params.fileId)); if (!item) throw Object.assign(new Error("File not found."), { status: 404 }); if (!canManageFile(data, item, req.viewer)) throw Object.assign(new Error("You can only edit files you uploaded in work assigned to you."), { status: 403 }); const allowedInput = req.viewer.role === "admin" ? input : { name: input.name, description: input.description, category: input.category }; Object.assign(item, allowedInput); audit(data, "File updated", `${item.name} file metadata changed.`, req.viewer.role); return item; }); res.json(file); }));
  app.delete("/api/files/:fileId", asyncRoute(async (req, res) => { let removedPath = ""; await store.update((data) => { const index = data.files!.findIndex((entry) => entry.id === String(req.params.fileId)); if (index < 0) throw Object.assign(new Error("File not found."), { status: 404 }); const file = data.files![index]; if (!canManageFile(data, file, req.viewer)) throw Object.assign(new Error("You can only delete files you uploaded in work assigned to you."), { status: 403 }); data.files!.splice(index, 1); removedPath = file.path; audit(data, "File deleted", `${file.name} was permanently deleted.`, req.viewer.role); }); if (removedPath) await unlink(removedPath).catch(() => undefined); res.json({ ok: true }); }));
  const canViewStoredFile = (data: PortalData, file: NonNullable<PortalData["files"]>[number] | undefined, user: PortalUser | undefined) => {
    if (!file || !user || !canProject(data, user, file.projectId) || !fileAudienceIncludes(file.visibility, user.role)) return false;
    if (user.role !== "subcontractor" || file.visibility === "project_access" || file.jobIds.length === 0) return true;
    return file.jobIds.some((jobId) => user.jobIds.includes(jobId));
  };
  app.get("/api/files/:fileId/download", asyncRoute(async (req, res) => { const data = await store.read(); const file = data.files!.find((item) => item.id === req.params.fileId); const user = userById(data, req.viewer.id); const potentialAccess = file && canAccessPotentialFile(data, user, file.id); if (!potentialAccess && !canViewStoredFile(data, file, user)) return res.status(403).json({ message: "You do not have access to this file." }); res.download(file!.path, file!.name); }));
  app.get("/api/files/:fileId/preview", asyncRoute(async (req, res) => { const data = await store.read(); const file = data.files!.find((item) => item.id === req.params.fileId); const user = userById(data, req.viewer.id); const potentialAccess = file && canAccessPotentialFile(data, user, file.id); if (!potentialAccess && !canViewStoredFile(data, file, user)) return res.status(403).json({ message: "You do not have access to this file." }); res.type(file!.mimeType); res.sendFile(file!.path); }));

  const payRequestSchema = z.object({ projectId: z.string(), jobId: z.string(), amountRequested: z.coerce.number().positive(), invoiceNumber: z.string().min(1), invoiceDate: z.string().date(), description: z.string().max(3000).default(""), invoice: z.object({ name: z.string().min(1), mimeType: z.string(), contentBase64: z.string().min(1) }), attachments: z.array(z.object({ name: z.string(), mimeType: z.string(), contentBase64: z.string() })).default([]) });
  app.post("/api/pay-requests", requireRole("subcontractor"), asyncRoute(async (req, res) => {
    const input = payRequestSchema.parse(req.body); const request = await store.update(async (data) => { const user = userById(data, req.viewer.id)!; if (!user.jobIds.includes(input.jobId) || !user.projectIds.includes(input.projectId)) throw Object.assign(new Error("This job is not assigned to you."), { status: 403 }); await mkdir(fileStorage, { recursive: true }); const save = async (file: { name: string; mimeType: string; contentBase64: string }) => { const fileId = id("attachment"); const path = resolve(fileStorage, fileId); const bytes = Buffer.from(file.contentBase64, "base64"); await writeFile(path, bytes); return { id: fileId, name: file.name, mimeType: file.mimeType, path, size: bytes.length }; }; const invoice = await save(input.invoice); const attachments = await Promise.all(input.attachments.map(save)); const item = { id: id("pay"), projectId: input.projectId, jobId: input.jobId, subcontractorId: user.id, subcontractorName: user.name, company: user.company || "", amountRequested: input.amountRequested, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, description: input.description, invoice, attachments, status: "submitted" as PayRequestStatus, readByAdmin: false, createdAt: isoNow(), updatedAt: isoNow(), activity: [{ id: id("event"), action: "Submitted", actorId: user.id, actorName: user.name, createdAt: isoNow() }] }; data.payRequests!.unshift(item); data.users!.filter((admin) => admin.role === "admin" && admin.active).forEach((admin) => notify(data, admin.id, "pay_request", "New pay request", `${user.company || user.name} submitted ${input.invoiceNumber}.`, "pay-requests", "high")); audit(data, "Pay request submitted", `${user.name} submitted ${input.invoiceNumber}.`, "subcontractor"); return item; }); res.status(201).json(request);
  }));
  app.get("/api/pay-requests/:payId/files/:fileId/preview", asyncRoute(async (req, res) => {
    const data = await store.read();
    const request = data.payRequests!.find((item) => item.id === req.params.payId);
    const allowed = request && (["admin", "project_manager"].includes(req.viewer.role) || (req.viewer.role === "subcontractor" && request.subcontractorId === req.viewer.id));
    if (!request || !allowed) return res.status(403).json({ message: "You do not have access to this invoice file." });
    const file = request.invoice.id === req.params.fileId ? request.invoice : request.attachments.find((item) => item.id === req.params.fileId);
    if (!file) return res.status(404).json({ message: "Invoice file not found." });
    res.type(file.mimeType || "application/octet-stream"); res.sendFile(file.path);
  }));
  app.patch("/api/pay-requests/:payId", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ status: z.enum(["submitted", "under_review", "approved", "partially_approved", "payment_processing", "paid", "rejected", "needs_revision"]), approvedAmount: z.coerce.number().nonnegative().optional(), adminNotes: z.string().max(3000).optional(), paymentDate: z.string().date().optional(), paymentReference: z.string().max(120).optional() }).parse(req.body); const result = await store.update((data) => { const item = data.payRequests!.find((entry) => entry.id === req.params.payId); if (!item) throw Object.assign(new Error("Pay request not found."), { status: 404 }); Object.assign(item, input, { updatedAt: isoNow(), readByAdmin: true }); const actor = userById(data, req.viewer.id)!; item.activity.push({ id: id("event"), action: input.status.replaceAll("_", " "), actorId: actor.id, actorName: actor.name, createdAt: isoNow(), note: input.adminNotes }); notify(data, item.subcontractorId, "pay_request", input.status === "paid" ? "Pay request paid" : "Pay request updated", input.status === "paid" ? `Your ${item.invoiceNumber} request has been marked paid.` : `Your ${item.invoiceNumber} request is now ${input.status.replaceAll("_", " ")}.`, "pay-requests", "high"); audit(data, "Pay request updated", `${item.invoiceNumber} marked ${input.status}.`); return item; }); res.json(result); }));
  app.post("/api/client-invoices", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ projectId: z.string(), clientId: z.string(), invoiceNumber: z.string().min(1).max(120), invoiceDate: z.string().date(), dueDate: z.string().date().optional().or(z.literal("")), amount: z.coerce.number().positive(), description: z.string().max(3000).default(""), status: z.enum(["draft", "sent", "paid", "void"]).default("draft") }).parse(req.body); const invoice = await store.update((data) => { if (!data.projects.some((project) => project.id === input.projectId) || !data.clients.some((client) => client.id === input.clientId)) throw Object.assign(new Error("Project or client was not found."), { status: 404 }); const now = isoNow(); const item = { id: id("client-invoice"), ...input, dueDate: input.dueDate || undefined, createdAt: now, updatedAt: now }; data.clientInvoices!.unshift(item); audit(data, "Client invoice created", `${item.invoiceNumber} created for client.`); return item; }); res.status(201).json(invoice); }));
  app.patch("/api/client-invoices/:invoiceId", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ projectId: z.string(), clientId: z.string(), invoiceNumber: z.string().min(1).max(120), invoiceDate: z.string().date(), dueDate: z.string().date().optional().or(z.literal("")), amount: z.coerce.number().positive(), description: z.string().max(3000).default(""), status: z.enum(["draft", "sent", "paid", "void"]) }).parse(req.body); const invoice = await store.update((data) => { const item = data.clientInvoices!.find((entry) => entry.id === req.params.invoiceId); if (!item) throw Object.assign(new Error("Invoice not found."), { status: 404 }); if (!data.projects.some((project) => project.id === input.projectId) || !data.clients.some((client) => client.id === input.clientId)) throw Object.assign(new Error("Project or client was not found."), { status: 404 }); Object.assign(item, input, { dueDate: input.dueDate || undefined, updatedAt: isoNow() }); audit(data, "Client invoice updated", `${item.invoiceNumber} updated.`); return item; }); res.json(invoice); }));
  app.delete("/api/client-invoices/:invoiceId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.clientInvoices!.findIndex((entry) => entry.id === req.params.invoiceId); if (index < 0) throw Object.assign(new Error("Invoice not found."), { status: 404 }); const [invoice] = data.clientInvoices!.splice(index, 1); audit(data, "Client invoice deleted", `${invoice.invoiceNumber} deleted.`); }); res.json({ ok: true }); }));
  app.get("/api/project-expenses", requireRole("admin"), asyncRoute(async (_req, res) => { const data = await store.read(); res.json(data.projectExpenses || []); }));
  app.post("/api/project-expenses", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ projectId: z.string().min(1), category: z.string().trim().min(2).max(80), description: z.string().trim().min(2).max(500), amount: z.coerce.number().positive(), spentOn: z.string().date() }).parse(req.body); const expense = await store.update((data) => { const project = data.projects.find((item) => item.id === input.projectId); if (!project) throw Object.assign(new Error("Project not found."), { status: 404 }); const item = { id: id("expense"), ...input, createdAt: isoNow(), createdBy: req.viewer.id }; data.projectExpenses!.unshift(item); audit(data, "Project expense added", `${project.name}: ${item.category} $${item.amount.toFixed(2)}.`); return item; }); res.status(201).json(expense); }));
  app.post("/api/projects/:projectId/invoice-log", asyncRoute(async (req, res) => {
    if (req.viewer.role === "project_manager") return res.status(403).json({ message: "Project Managers can view existing project invoices but cannot change them." });
    const input = z.object({ invoiceNumber: z.string().trim().min(1).max(120), invoiceDate: z.string().date(), amount: z.coerce.number().positive(), description: z.string().trim().max(3000).optional(), purchasedByContractorId: z.string().optional().or(z.literal("")), attachment: z.object({ name: z.string().min(1).max(200), mimeType: z.string().min(1), contentBase64: z.string().min(1) }).optional() }).parse(req.body);
    const invoice = await store.update(async (data) => {
      const user = userById(data, req.viewer.id);
      const project = data.projects.find((item) => item.id === req.params.projectId);
      if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
      if (!canProject(data, user, project.id)) throw Object.assign(new Error("You do not have access to this project."), { status: 403 });
      const assignedContractorIds = new Set(data.jobs.filter((job) => job.projectId === project.id && job.contractorId).map((job) => job.contractorId!));
      const purchasedBy = input.purchasedByContractorId ? data.contractors.find((contractor) => contractor.id === input.purchasedByContractorId && assignedContractorIds.has(contractor.id)) : undefined;
      if (input.purchasedByContractorId && !purchasedBy) throw Object.assign(new Error("Choose a subcontractor assigned to this project."), { status: 400 });
      let fileId: string | undefined;
      let fileName: string | undefined;
      if (input.attachment) {
        const bytes = Buffer.from(input.attachment.contentBase64, "base64");
        if (bytes.length > 12 * 1024 * 1024) throw Object.assign(new Error("Each file must be 12 MB or smaller."), { status: 400 });
        fileId = id("file"); fileName = input.attachment.name;
        await mkdir(fileStorage, { recursive: true });
        const path = resolve(fileStorage, fileId);
        await writeFile(path, bytes);
        data.files!.unshift({ id: fileId, projectId: project.id, jobIds: [], name: fileName, mimeType: input.attachment.mimeType, size: bytes.length, path, category: "Invoice", description: `Attachment for ${input.invoiceNumber}`, visibility: "project_access", uploadedBy: req.viewer.id, createdAt: isoNow() });
      }
      const { attachment: _attachment, purchasedByContractorId: _purchasedByContractorId, ...invoiceInput } = input;
      const item = { id: id("project-invoice"), projectId: project.id, ...invoiceInput, description: input.description || undefined, fileId, fileName, purchasedByContractorId: purchasedBy?.id, purchasedByContractorName: purchasedBy?.company || purchasedBy?.name, createdBy: req.viewer.id, createdByName: user?.name || "Project user", createdAt: isoNow() };
      data.projectInvoiceLogs!.unshift(item);
      audit(data, "Project invoice logged", `${project.number}: ${item.invoiceNumber} logged by ${item.createdByName}.`, req.viewer.role);
      data.users?.filter((account) => account.role === "admin" && account.active).forEach((account) => notify(data, account.id, "invoice", "Project invoice logged", `${project.name}: ${item.invoiceNumber} was logged.`, "projects", "normal"));
      return item;
    });
    res.status(201).json(invoice);
  }));
  app.patch("/api/projects/:projectId/invoice-log/:invoiceId", asyncRoute(async (req, res) => {
    if (req.viewer.role === "project_manager") return res.status(403).json({ message: "Project Managers can view existing project invoices but cannot change them." });
    const input = z.object({ invoiceNumber: z.string().trim().min(1).max(120), invoiceDate: z.string().date(), amount: z.coerce.number().positive(), description: z.string().trim().max(3000).optional(), purchasedByContractorId: z.string().optional().or(z.literal("")) }).parse(req.body);
    const invoice = await store.update((data) => {
      const user = userById(data, req.viewer.id); const project = data.projects.find((item) => item.id === req.params.projectId);
      const item = data.projectInvoiceLogs!.find((entry) => entry.id === req.params.invoiceId && entry.projectId === req.params.projectId);
      if (!project || !item) throw Object.assign(new Error("Project invoice not found."), { status: 404 });
      if (!canProject(data, user, project.id) || !(req.viewer.role === "admin" || req.viewer.role === "project_manager" || item.createdBy === req.viewer.id)) throw Object.assign(new Error("You can only edit invoices you logged."), { status: 403 });
      const assignedContractorIds = new Set(data.jobs.filter((job) => job.projectId === project.id && job.contractorId).map((job) => job.contractorId!));
      const purchasedBy = input.purchasedByContractorId ? data.contractors.find((contractor) => contractor.id === input.purchasedByContractorId && assignedContractorIds.has(contractor.id)) : undefined;
      if (input.purchasedByContractorId && !purchasedBy) throw Object.assign(new Error("Choose a subcontractor assigned to this project."), { status: 400 });
      const { purchasedByContractorId: _purchasedByContractorId, ...updates } = input;
      Object.assign(item, { ...updates, description: input.description || undefined, purchasedByContractorId: purchasedBy?.id, purchasedByContractorName: purchasedBy?.company || purchasedBy?.name });
      audit(data, "Project invoice updated", `${project.number}: ${item.invoiceNumber} updated.`, req.viewer.role); return item;
    });
    res.json(invoice);
  }));
  app.delete("/api/projects/:projectId/invoice-log/:invoiceId", asyncRoute(async (req, res) => {
    if (req.viewer.role === "project_manager") return res.status(403).json({ message: "Project Managers can view existing project invoices but cannot change them." });
    let removedPath = "";
    await store.update((data) => {
      const user = userById(data, req.viewer.id); const project = data.projects.find((item) => item.id === req.params.projectId);
      const index = data.projectInvoiceLogs!.findIndex((entry) => entry.id === req.params.invoiceId && entry.projectId === req.params.projectId);
      if (!project || index < 0) throw Object.assign(new Error("Project invoice not found."), { status: 404 });
      const item = data.projectInvoiceLogs![index];
      if (!canProject(data, user, project.id) || !(req.viewer.role === "admin" || req.viewer.role === "project_manager" || item.createdBy === req.viewer.id)) throw Object.assign(new Error("You can only delete invoices you logged."), { status: 403 });
      data.projectInvoiceLogs!.splice(index, 1);
      if (item.fileId) { const fileIndex = data.files!.findIndex((file) => file.id === item.fileId); if (fileIndex >= 0) removedPath = data.files!.splice(fileIndex, 1)[0].path; }
      audit(data, "Project invoice deleted", `${project.number}: ${item.invoiceNumber} deleted.`, req.viewer.role);
    });
    if (removedPath) await unlink(removedPath).catch(() => undefined);
    res.json({ ok: true });
  }));
  app.patch("/api/project-expenses/:expenseId", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ category: z.string().trim().min(2).max(80), description: z.string().trim().min(2).max(500), amount: z.coerce.number().positive(), spentOn: z.string().date() }).parse(req.body); const expense = await store.update((data) => { const item = data.projectExpenses!.find((entry) => entry.id === req.params.expenseId); if (!item) throw Object.assign(new Error("Expense not found."), { status: 404 }); const previous = `${item.category} $${item.amount.toFixed(2)}`; Object.assign(item, input); audit(data, "Project expense updated", `${previous} updated to ${item.category} $${item.amount.toFixed(2)}.`); return item; }); res.json(expense); }));
  app.delete("/api/project-expenses/:expenseId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.projectExpenses!.findIndex((item) => item.id === req.params.expenseId); if (index < 0) return; const [item] = data.projectExpenses!.splice(index, 1); audit(data, "Project expense deleted", `${item.category} $${item.amount.toFixed(2)} removed.`); }); res.json({ ok: true }); }));

  const potentialSchema = z.object({ projectId: z.string(), title: z.string().min(2), trade: z.string().min(2), scope: z.string().min(4), location: z.string().min(2), estimatedStartDate: z.string().date().optional().or(z.literal("")), estimatedCompletionDate: z.string().date().optional().or(z.literal("")), bidDue: z.string().date().optional().or(z.literal("")), budget: z.coerce.number().nonnegative().optional(), notes: z.string().max(3000).optional(), visibleTo: z.enum(["all", "trade", "specific"]), contractorIds: z.array(z.string()).default([]), fileIds: z.array(z.string()).default([]) });
  app.post("/api/potential-jobs", requireRole("admin"), asyncRoute(async (req, res) => { const input = potentialSchema.parse(req.body); const potential = await store.update((data) => { const item = { id: id("potential"), ...input, estimatedStartDate: input.estimatedStartDate || undefined, estimatedCompletionDate: input.estimatedCompletionDate || undefined, bidDue: input.bidDue || undefined, status: "open" as const, createdAt: isoNow() }; data.potentialJobs!.unshift(item); const recipients = data.users!.filter((user) => user.role === "subcontractor" && user.active && (item.visibleTo === "all" || (item.visibleTo === "trade" && user.trade?.toLowerCase() === item.trade.toLowerCase()) || item.contractorIds.includes(user.id))); recipients.forEach((user) => notify(data, user.id, "potential_job", "New potential job", `${item.title} is available to review.`, "potential", "high")); audit(data, "Potential job posted", item.title); return item; }); res.status(201).json(potential); }));
  app.patch("/api/potential-jobs/:potentialId", requireRole("admin"), asyncRoute(async (req, res) => { const input = potentialSchema.partial().extend({ status: z.enum(["open", "awarded", "closed"]).optional() }).parse(req.body); const item = await store.update((data) => { const job = data.potentialJobs!.find((entry) => entry.id === req.params.potentialId); if (!job) throw Object.assign(new Error("Potential job not found."), { status: 404 }); Object.assign(job, input); audit(data, "Potential job updated", job.title); return job; }); res.json(item); }));
  app.delete("/api/potential-jobs/:potentialId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const index = data.potentialJobs!.findIndex((entry) => entry.id === req.params.potentialId); if (index < 0) throw Object.assign(new Error("Potential job not found."), { status: 404 }); const [job] = data.potentialJobs!.splice(index, 1); data.bids = data.bids!.filter((bid) => bid.potentialJobId !== job.id); audit(data, "Potential job deleted", job.title); }); res.json({ ok: true }); }));
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

  app.post("/api/projects", requireRole("admin", "project_manager"), asyncRoute(async (req, res) => {
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
        displayOrder: data.projects.length,
      };
      data.projects.push(value);
      const clientUser = userById(data, client.id); if (clientUser) clientUser.projectIds = [...new Set([...clientUser.projectIds, value.id])];
      audit(data, "Project created", `${value.number} · ${value.name}`);
      return value;
    });
    res.status(201).json(project);
  }));

  app.patch("/api/projects/order", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = z.object({ projectIds: z.array(z.string()).min(1) }).parse(req.body);
    const ordered = await store.update((data) => {
      if (new Set(input.projectIds).size !== input.projectIds.length || input.projectIds.length !== data.projects.length || input.projectIds.some((projectId) => !data.projects.some((project) => project.id === projectId))) {
        throw Object.assign(new Error("The project order was out of date. Please try again."), { status: 400 });
      }
      const position = new Map(input.projectIds.map((projectId, index) => [projectId, index]));
      data.projects.forEach((project) => { project.displayOrder = position.get(project.id)!; });
      audit(data, "Project card order updated", "Projects & jobs priorities were rearranged.");
      return [...data.projects].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    });
    res.json(ordered);
  }));

  const accessSchema = z.object({ userIds: z.array(z.string()).default([]) });
  app.patch("/api/projects/:projectId/access", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = accessSchema.parse(req.body);
    await store.update((data) => {
      const project = data.projects.find((item) => item.id === req.params.projectId);
      if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
      const selected = new Set(input.userIds);
      if ([...selected].some((userId) => !data.users?.some((user) => user.id === userId && user.active))) throw Object.assign(new Error("One or more selected users are unavailable."), { status: 400 });
      data.users?.filter((user) => user.role === "client" || user.role === "subcontractor").forEach((user) => {
        user.projectIds = selected.has(user.id) ? [...new Set([...user.projectIds, project.id])] : user.projectIds.filter((projectId) => projectId !== project.id);
        if (!selected.has(user.id)) user.jobIds = user.jobIds.filter((jobId) => !data.jobs.some((job) => job.id === jobId && job.projectId === project.id));
      });
      audit(data, "Project access updated", `${project.number} user access updated.`);
    });
    res.json({ ok: true });
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

  app.patch("/api/projects/:projectId/field-notes", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ fieldNotes: z.string().trim().max(5000) }).parse(req.body); const project = await store.update((data) => { const item = data.projects.find((candidate) => candidate.id === req.params.projectId); if (!item) throw Object.assign(new Error("Project not found."), { status: 404 }); item.fieldNotes = input.fieldNotes; audit(data, "Project field notes updated", `${item.number} field notes updated.`, req.viewer.role); return item; }); res.json(project); }));
  app.patch("/api/projects/:projectId/client-contact", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(200), phone: z.string().trim().max(60).optional(), contractCost: z.coerce.number().nonnegative() }).parse(req.body); const result = await store.update((data) => { const project = data.projects.find((item) => item.id === req.params.projectId); if (!project) throw Object.assign(new Error("Project not found."), { status: 404 }); project.clientContactName = input.name; project.clientContactEmail = input.email; project.clientContactPhone = input.phone || ""; project.budget = input.contractCost; // This is deliberately project-only: it never updates a client record, a job,
    // or a portal-access user. Access is managed solely by the checkbox list.
    audit(data, "Client contact updated", `${project.number}: ${input.name} contact and contract cost updated.`); return { project, client: { name: project.clientContactName, email: project.clientContactEmail }, phone: project.clientContactPhone }; }); res.json(result); }));
  app.post("/api/projects/:projectId/milestones", requireRole("admin"), asyncRoute(async (req, res) => { const input = z.object({ title: z.string().trim().min(2).max(120), date: z.string().date(), details: z.string().trim().max(1000).optional() }).parse(req.body); const milestone = await store.update((data) => { const project = data.projects.find((item) => item.id === req.params.projectId); if (!project) throw Object.assign(new Error("Project not found."), { status: 404 }); const item = { id: id("milestone"), title: input.title, date: input.date, details: input.details || undefined, createdAt: isoNow() }; project.milestones = [...(project.milestones || []), item].sort((a, b) => a.date.localeCompare(b.date)); audit(data, "Project milestone added", `${project.number}: ${item.title} on ${item.date}.`); data.users?.filter((user) => user.role === "subcontractor" && user.active && user.projectIds.includes(project.id)).forEach((user) => notify(data, user.id, "project_update", "Project milestone added", `${project.name}: ${item.title} · ${item.date}.`, "jobs", "normal")); return item; }); res.status(201).json(milestone); }));
  app.delete("/api/projects/:projectId/milestones/:milestoneId", requireRole("admin"), asyncRoute(async (req, res) => { await store.update((data) => { const project = data.projects.find((item) => item.id === req.params.projectId); if (!project) throw Object.assign(new Error("Project not found."), { status: 404 }); const index = (project.milestones || []).findIndex((item) => item.id === req.params.milestoneId); if (index < 0) throw Object.assign(new Error("Milestone not found."), { status: 404 }); const [item] = project.milestones!.splice(index, 1); audit(data, "Project milestone removed", `${project.number}: ${item.title}.`); }); res.json({ ok: true }); }));
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
      const clientUser = userById(data, client.id); if (clientUser) clientUser.projectIds = [...new Set([...clientUser.projectIds, project.id])];
      if (contractor) subcontractorUsersFor(data, contractor.id).forEach((contractorUser) => { contractorUser.projectIds = [...new Set([...contractorUser.projectIds, project.id])]; contractorUser.jobIds = [...new Set([...contractorUser.jobIds, value.id])]; });
      notifyJobParticipants(data, value, "New job assigned", `${value.title} has been added to your project.`);
      audit(data, "Job created", `${value.number} added under ${project.name}`);
      return value;
    });
    res.status(201).json(job);
  }));

  const jobEditSchema = z.object({ title: z.string().trim().min(2), scope: z.string().trim().min(4), location: z.string().trim().min(2), price: z.coerce.number().nonnegative(), stage: z.string().trim().min(2), progress: z.coerce.number().min(0).max(100).optional(), status: z.enum(["planned", "scheduled", "in_progress", "complete", "on_hold"]).optional(), scheduleStart: z.string().date().optional().or(z.literal("")), scheduleEnd: z.string().date().optional().or(z.literal("")), clientId: z.string().min(1), contractorId: z.string().optional().or(z.literal("")), subcontractorInstructions: z.string().trim().max(5000).optional() });
  app.patch("/api/jobs/:jobId/access", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = accessSchema.parse(req.body);
    await store.update((data) => {
      const job = data.jobs.find((item) => item.id === req.params.jobId);
      if (!job) throw Object.assign(new Error("Job not found."), { status: 404 });
      const selected = new Set(input.userIds);
      // Selecting a subcontractor in the job form is itself an assignment.
      // Keep that account selected even if the optional checkbox list was not
      // touched, so the follow-up access save cannot undo the assignment.
      subcontractorUsersFor(data, job.contractorId).forEach((user) => selected.add(user.id));
      if ([...selected].some((userId) => !data.users?.some((user) => user.id === userId && user.active))) throw Object.assign(new Error("One or more selected users are unavailable."), { status: 400 });
      data.users?.filter((user) => user.role === "client" || user.role === "subcontractor").forEach((user) => {
        user.jobIds = selected.has(user.id) ? [...new Set([...user.jobIds, job.id])] : user.jobIds.filter((jobId) => jobId !== job.id);
        if (selected.has(user.id)) user.projectIds = [...new Set([...user.projectIds, job.projectId])];
      });
      audit(data, "Job access updated", `${job.number} user access updated.`);
    });
    res.json({ ok: true });
  }));
  app.patch("/api/jobs/:jobId", requireRole("admin"), asyncRoute(async (req, res) => { const input = jobEditSchema.parse(req.body); const job = await store.update((data) => { const item = data.jobs.find((candidate) => candidate.id === req.params.jobId); const client = data.clients.find((candidate) => candidate.id === input.clientId); const contractor = input.contractorId ? data.contractors.find((candidate) => candidate.id === input.contractorId) : undefined; if (!item) throw Object.assign(new Error("Job not found."), { status: 404 }); if (!client) throw Object.assign(new Error("Client not found."), { status: 404 }); if (input.contractorId && !contractor) throw Object.assign(new Error("Subcontractor not found."), { status: 404 }); const { scheduleStart, scheduleEnd, ...updates } = input; Object.assign(item, updates, { scheduleStart: scheduleStart || undefined, scheduleEnd: scheduleEnd || undefined, contractorId: contractor?.id, contractorName: contractor?.company, clientId: client.id, clientName: client.name }); if (item.status === "complete") item.progress = 100; const clientUser = userById(data, client.id); if (clientUser) clientUser.projectIds = [...new Set([...clientUser.projectIds, item.projectId])]; if (contractor) subcontractorUsersFor(data, contractor.id).forEach((contractorUser) => { contractorUser.projectIds = [...new Set([...contractorUser.projectIds, item.projectId])]; contractorUser.jobIds = [...new Set([...contractorUser.jobIds, item.id])]; }); refreshProject(data, item.projectId); audit(data, "Job updated", `${item.number} job details updated.`); notifyJobParticipants(data, item, "Job updated", `${item.title} has been updated.`); return item; }); res.json(job); }));
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
      audit(data, "Job scheduled", `${item.number} · ${input.scheduleStart} to ${input.scheduleEnd}`); notifyJobParticipants(data, item, "Job schedule updated", `${item.title} is scheduled for ${input.scheduleStart} through ${input.scheduleEnd}.`);
      return item;
    });
    res.json(job);
  }));

  const phaseTemplates: Record<string, Array<[string, number]>> = { concrete: [["Scheduled",0],["Pad Prep",25],["Ready for Pour / Inspection",50],["Pour Day",75],["Complete",100]], plumbing: [["Scheduled",0],["Underground",20],["Rough-In",40],["Top-Out",60],["Fixtures / Trim-Out",85],["Final Inspection",95],["Complete",100]], electrical: [["Scheduled",0],["Layout",10],["Rough-In",35],["Panel / Service",55],["Devices / Fixtures",80],["Final Inspection",95],["Complete",100]], hvac: [["Scheduled",0],["Layout",10],["Ductwork",30],["Equipment Set",55],["Connections",75],["Startup / Testing",90],["Complete",100]], framing: [["Scheduled",0],["Material Delivery",10],["Layout",20],["Walls",45],["Roof / Ceiling Framing",70],["Punch / Corrections",90],["Complete",100]] };
  const phasesFor = (job: Job) => phaseTemplates[Object.keys(phaseTemplates).find((trade) => `${job.title} ${job.scope}`.toLowerCase().includes(trade)) || ""] || [["Scheduled",0],["In Progress",50],["Complete",100]];
  const refreshProject = (data: PortalData, projectId: string) => { const project = data.projects.find((candidate) => candidate.id === projectId); const jobs = data.jobs.filter((candidate) => candidate.projectId === projectId); if (!project || !jobs.length) return; project.progress = Math.round(jobs.reduce((sum, job) => sum + job.progress, 0) / jobs.length); project.currentStage = [...jobs].sort((a,b) => b.progress-a.progress)[0]?.stage || project.currentStage; project.status = jobs.every((job) => job.status === "complete") ? "complete" : "active"; };
  app.get("/api/jobs/:jobId/phases", asyncRoute(async (req,res) => { const data=await store.read(); const job=data.jobs.find((item)=>item.id===req.params.jobId); if(!job) return res.status(404).json({message:"Job not found."}); res.json({ phases: phasesFor(job) }); }));
  app.patch("/api/jobs/:jobId/phase", requireRole("admin"), asyncRoute(async (req,res) => { const input=z.object({ phase:z.string().min(2) }).parse(req.body); const job=await store.update((data)=>{ const item=data.jobs.find((candidate)=>candidate.id===req.params.jobId); if(!item) throw Object.assign(new Error("Job not found."),{status:404}); const pair=phasesFor(item).find(([name])=>name===input.phase); if(!pair) throw Object.assign(new Error("Choose a phase for this job's trade."),{status:400}); item.stage=pair[0]; item.progress=pair[1]; item.status=pair[1]===100?"complete":pair[1]>0?"in_progress":item.scheduleStart?"scheduled":"planned"; refreshProject(data,item.projectId); audit(data,"Job phase updated",`${item.number} moved to ${pair[0]} (${pair[1]}%).`); return item; }); res.json(job); }));
  app.patch("/api/projects/:projectId/complete", requireRole("admin"), asyncRoute(async (req,res)=>{ const input=z.object({complete:z.boolean()}).parse(req.body); const project=await store.update((data)=>{const item=data.projects.find((x)=>x.id===req.params.projectId); if(!item) throw Object.assign(new Error("Project not found."),{status:404}); item.status=input.complete?"complete":"active"; item.progress=input.complete?100:Math.min(item.progress,99); audit(data,input.complete?"Project completed":"Project reopened",item.number); return item;}); res.json(project); }));
  app.patch("/api/projects/:projectId/progress", requireRole("admin"), asyncRoute(async (req,res)=>{ const input=z.object({ stage:z.string().trim().min(2), progress:z.coerce.number().min(0).max(100), override:z.boolean().default(true) }).parse(req.body); const project=await store.update((data)=>{const item=data.projects.find((x)=>x.id===req.params.projectId); if(!item) throw Object.assign(new Error("Project not found."),{status:404}); item.currentStage=input.stage; item.progress=input.progress; item.status=input.progress===100?"complete":"active"; audit(data,"Project progress updated",`${item.number} moved to ${input.stage} at ${input.progress}%.`); return item;}); res.json(project); }));
  app.patch("/api/projects/:projectId/work-status", requireRole("admin"), asyncRoute(async (req,res)=>{ const input=z.object({ status:z.enum(["new","lost","scheduled","in_progress","completed"]) }).parse(req.body); const project=await store.update((data)=>{ const item=data.projects.find((candidate)=>candidate.id===req.params.projectId); if(!item) throw Object.assign(new Error("Project not found."),{status:404}); item.workStatus=input.status; if(input.status==="completed") { item.status="complete"; item.progress=100; } else if(input.status==="lost") item.status="on_hold"; else if(item.status==="complete" || item.status==="on_hold") item.status="active"; audit(data,"Project status updated",`${item.number} marked ${input.status.replaceAll("_", " ")}.`); return item; }); res.json(project); }));
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
      refreshProject(data, item.projectId);
      audit(data, "Progress updated", `${item.number} moved to ${item.stage} at ${item.progress}%`); notifyJobParticipants(data, item, "Job progress updated", `${item.title} is now ${item.progress}% complete (${item.stage}).`);
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
      notifyJobParticipants(data, job, "You have been assigned a job", `${job.title} has been assigned to you.`);

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
    res.type("application/pdf").sendFile(path);
  }));

  const interestSchema = z.object({
    phone: z.string().trim().min(7).max(30),
    availability: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(1000).default(""),
  });

  app.post("/api/jobs/:jobId/interests", requireRole("subcontractor"), asyncRoute(async (req, res) => {
    const input = interestSchema.parse(req.body);
    const result = await store.update((data) => {
      const job = data.jobs.find((item) => item.id === req.params.jobId && item.interestOpen) || (() => { const potential = data.potentialJobs!.find((item) => item.id === req.params.jobId && item.status === "open"); return potential ? { id: potential.id, number: potential.title, interestOpen: true } : undefined; })();
      const contractor = data.contractors.find((item) => item.id === req.viewer.id) || userById(data, req.viewer.id);
      if (!job) throw Object.assign(new Error("This job is no longer accepting interest."), { status: 404 });
      if (!contractor || ("role" in contractor && contractor.role !== "subcontractor")) throw Object.assign(new Error("Subcontractor profile not found."), { status: 404 });
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
    companyAddress: z.string().max(300).default(""), companyPhone: z.string().max(60).default(""), companyWebsite: z.string().max(200).default(""),
    defaultClientMessage: z.string().max(2000).default(""), defaultSubcontractorMessage: z.string().max(2000).default(""),
    scheduleDays: z.coerce.number().int().min(7).max(30).default(14), weekendWorkAllowed: z.boolean().default(false),
    notificationRules: z.record(z.string(), z.object({ inApp: z.boolean(), sms: z.boolean(), email: z.boolean() })).default({}),
    clientPortal: z.object({ schedule: z.boolean(), files: z.boolean(), photos: z.boolean(), progress: z.boolean() }).default({ schedule: true, files: true, photos: true, progress: true }),
    subcontractorPortal: z.object({ sharedFiles: z.boolean(), schedule: z.boolean(), projectAddress: z.boolean(), payRequests: z.boolean() }).default({ sharedFiles: true, schedule: true, projectAddress: true, payRequests: true }),
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
