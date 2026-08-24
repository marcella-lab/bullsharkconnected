import { resolve, sep } from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AuditEntry, BootstrapPayload, Contract, Job, PortalData, Role } from "../src/types.js";
import { ConfiguredEsignService, contractStorage, generateContractPdf, type ContractContext, type EsignService } from "./contracts.js";
import type { DataStore } from "./store.js";

declare global {
  namespace Express {
    interface Request {
      viewer: { role: Role; id: string };
    }
  }
}

const roles = ["admin", "client", "subcontractor"] as const;
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const isoNow = () => new Date().toISOString();

const asyncRoute = (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next);

const audit = (data: PortalData, action: string, detail: string, role: Role = "admin") => {
  const entry: AuditEntry = { id: id("audit"), action, detail, actorRole: role, createdAt: isoNow() };
  data.audit.unshift(entry);
  data.audit = data.audit.slice(0, 100);
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
  if (role === "admin") return data;
  if (role === "client") {
    const projects = data.projects.filter((project) => project.clientId === viewerId);
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
  };
};

export function createApp(store: DataStore, esign: EsignService = new ConfiguredEsignService()) {
  const app = express();
  app.use(cors({ origin: process.env.APP_URL || "http://localhost:5173" }));
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const parsed = z.enum(roles).safeParse(req.header("x-user-role") || "client");
    if (!parsed.success) return res.status(400).json({ message: "Unknown portal role." });
    req.viewer = {
      role: parsed.data,
      id: req.header("x-user-id") || (parsed.data === "client" ? "client-1" : parsed.data === "subcontractor" ? "contractor-1" : "admin-1"),
    };
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/bootstrap", asyncRoute(async (req, res) => {
    const all = await store.read();
    const data = filteredData(all, req.viewer.role, req.viewer.id);
    const name = req.viewer.role === "admin"
      ? "Marcella Johnson"
      : data.clients[0]?.name || data.contractors[0]?.name || "Portal user";
    const payload: BootstrapPayload = { ...data, viewer: { ...req.viewer, name } };
    res.json(payload);
  }));

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
  });

  app.post("/api/projects/:projectId/jobs", requireRole("admin"), asyncRoute(async (req, res) => {
    const input = jobSchema.parse(req.body);
    const job = await store.update((data) => {
      const project = data.projects.find((item) => item.id === req.params.projectId);
      if (!project) throw Object.assign(new Error("Project not found."), { status: 404 });
      const siblingCount = data.jobs.filter((item) => item.projectId === project.id).length;
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
      };
      data.jobs.push(value);
      audit(data, "Job created", `${value.number} added under ${project.name}`);
      return value;
    });
    res.status(201).json(job);
  }));

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

  app.get("/api/contracts/:contractId/pdf", requireRole("admin", "subcontractor"), asyncRoute(async (req, res) => {
    const data = await store.read();
    const contract = data.contracts.find((item) => item.id === req.params.contractId);
    if (!contract) return res.status(404).json({ message: "Contract not found." });
    if (req.viewer.role === "subcontractor" && contract.contractorId !== req.viewer.id) {
      return res.status(403).json({ message: "You do not have access to this contract." });
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
