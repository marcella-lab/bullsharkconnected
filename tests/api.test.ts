import { access } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PortalData } from "../src/types.js";
import { createApp } from "../server/app.js";
import { seedData } from "../server/seed.js";
import { MemoryDataStore } from "../server/store.js";

const headers = (role: string, id: string) => ({ "x-user-role": role, "x-user-id": id });

describe("BullShark portal API", () => {
  it("creates a PDF contract automatically when a job is assigned", async () => {
    const store = new MemoryDataStore();
    const app = createApp(store);
    const response = await request(app)
      .post("/api/jobs/job-2/assign")
      .set(headers("admin", "admin-1"))
      .send({
        contractorId: "contractor-1",
        contractNumber: "BSC-TEST-0001",
        price: 91000,
        paymentTerms: "Net 30 after approval",
        notes: "Include engineered truss setting.",
        sendNow: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.job.contractorId).toBe("contractor-1");
    expect(response.body.contract.status).toBe("ready");
    expect(response.body.contract.envelopeId).toBe(`demo-${response.body.contract.id}`);
    await expect(access(response.body.contract.pdfPath)).resolves.toBeUndefined();
  });

  it("filters client data and exposes published schedule dates without contracts", async () => {
    const data: PortalData = structuredClone(seedData);
    data.contracts.push({
      id: "contract-hidden",
      jobId: "job-1",
      projectId: "project-1",
      contractorId: "contractor-1",
      contractNumber: "PRIVATE-1",
      price: 100,
      paymentTerms: "Net 30",
      notes: "",
      status: "draft",
      pdfPath: "hidden.pdf",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const response = await request(createApp(new MemoryDataStore(data)))
      .get("/api/bootstrap")
      .set(headers("client", "client-1"));

    expect(response.status).toBe(200);
    expect(response.body.projects).toHaveLength(1);
    expect(response.body.projects[0].clientId).toBe("client-1");
    expect(response.body.contracts).toEqual([]);
    expect(response.body.jobs.some((job: { scheduleStart?: string }) => Boolean(job.scheduleStart))).toBe(true);
  });

  it("completes the interested flow and returns the existing confirmation on repeat", async () => {
    const app = createApp(new MemoryDataStore());
    const first = await request(app)
      .post("/api/jobs/job-3/interests")
      .set(headers("subcontractor", "contractor-1"))
      .send({ phone: "210-555-0148", availability: "Available September 8–22", notes: "Three-person steel crew." });
    const repeat = await request(app)
      .post("/api/jobs/job-3/interests")
      .set(headers("subcontractor", "contractor-1"))
      .send({ phone: "210-555-0148", availability: "Available now", notes: "" });

    expect(first.status).toBe(201);
    expect(first.body.message).toMatch(/Interest submitted/);
    expect(repeat.status).toBe(200);
    expect(repeat.body.duplicate).toBe(true);
    expect(repeat.body.submission.id).toBe(first.body.submission.id);
  });

  it("enforces admin-only settings and rejects the removed estimator role", async () => {
    const app = createApp(new MemoryDataStore());
    const denied = await request(app)
      .patch("/api/settings")
      .set(headers("client", "client-1"))
      .send({});
    const estimator = await request(app)
      .get("/api/bootstrap")
      .set(headers("estimator", "estimator-1"));

    expect(denied.status).toBe(403);
    expect(estimator.status).toBe(400);
  });

  it("calculates and stores the required concrete yardage formula on the backend", async () => {
    const app = createApp(new MemoryDataStore());
    const created = await request(app).post("/api/yardage").set(headers("admin", "admin-1")).send({
      status: "ACTIVE", state: "NV", concreteCompany: "Cemex", client: "Angelo / Debbie Spinelli",
      dimensions: "60 x 40", thickness: 6, footers: "18x24", additionalConcreteYardage: 2, wasteOverageYardage: 1.5, concreteCost: 13000, subCost: 13600, contractCost: 32000,
    });
    expect(created.status).toBe(201);
    expect(created.body.padYardage).toBeCloseTo(44.4444, 3);
    expect(created.body.footerYardage).toBeCloseTo(22.2222, 3);
    expect(created.body.totalYardage).toBeCloseTo(66.6666, 3);
    expect(created.body.slabSquareFeet).toBe(2400);
    expect(created.body.slabYardage).toBeCloseTo(44.4444, 3);
    expect(created.body.finalOrderYardage).toBeCloseTo(70.1666, 3);
    expect(created.body.concreteCost + created.body.subCost).toBe(26600);
    expect(created.body.contractCost - created.body.concreteCost - created.body.subCost).toBe(5400);
    const denied = await request(app).get("/api/yardage").set(headers("client", "client-1"));
    expect(denied.status).toBe(403);
  });

  it("lets an admin edit both client and subcontractor assignments, but protects deletes", async () => {
    const app = createApp(new MemoryDataStore());
    const edited = await request(app).patch("/api/jobs/job-1").set(headers("admin", "admin-1")).send({ title: "Foundation concrete", scope: "Place and finish foundation concrete.", location: "Existing job location", price: 1000, stage: "Planned", clientId: "client-2", contractorId: "contractor-2" });
    expect(edited.status).toBe(200);
    expect(edited.body.clientId).toBe("client-2");
    expect(edited.body.contractorId).toBe("contractor-2");
    const denied = await request(app).delete("/api/jobs/job-1").set(headers("client", "client-1"));
    expect(denied.status).toBe(403);
  });

  it("lets project managers add projects but blocks changes to existing records", async () => {
    const app = createApp(new MemoryDataStore());
    const read = await request(app).get("/api/bootstrap").set(headers("project_manager", "project-manager-1"));
    const created = await request(app).post("/api/projects").set(headers("project_manager", "project-manager-1")).send({ name: "Manager-created project", address: "100 Main Street", clientId: "client-1", manager: "Project Manager", budget: 1000, startDate: "2026-09-01", targetDate: "2026-09-30" });
    const write = await request(app).delete("/api/projects/project-1").set(headers("project_manager", "project-manager-1"));
    expect(read.status).toBe(200);
    expect(read.body.projects.length).toBeGreaterThan(0);
    expect(created.status).toBe(201);
    expect(write.status).toBe(403);
  });

  it("makes a newly created client account available for project assignment", async () => {
    const app = createApp(new MemoryDataStore());
    const created = await request(app).post("/api/users").set(headers("admin", "admin-1")).send({ role: "client", name: "New Client", email: "new.client@example.com", projectIds: [], jobIds: [], active: true });
    expect(created.status).toBe(201);
    const project = await request(app).post("/api/projects").set(headers("admin", "admin-1")).send({ name: "New Client Project", address: "100 Main Street", clientId: created.body.id, manager: "Project Manager", budget: 1000, startDate: "2026-09-01", targetDate: "2026-09-30" });
    expect(project.status).toBe(201);
    expect(project.body.clientId).toBe(created.body.id);
    expect(project.body.clientName).toBe("New Client");
  });

  it("lets clients manage only their own project files while admins retain full control", async () => {
    const app = createApp(new MemoryDataStore());
    const clientFile = await request(app).post("/api/files").set(headers("client", "client-1")).send({ projectId: "project-1", jobIds: [], name: "Client photo.jpg", mimeType: "image/jpeg", contentBase64: Buffer.from("client image").toString("base64"), category: "Photos", description: "Client upload", visibility: "client" });
    expect(clientFile.status).toBe(201);
    const ownEdit = await request(app).patch(`/api/files/${clientFile.body.id}`).set(headers("client", "client-1")).send({ name: "Updated client photo.jpg" });
    expect(ownEdit.status).toBe(200);
    const adminFile = await request(app).post("/api/files").set(headers("admin", "admin-1")).send({ projectId: "project-1", jobIds: [], name: "Admin plan.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("admin document").toString("base64"), category: "Plans", description: "Admin upload", visibility: "client" });
    expect(adminFile.status).toBe(201);
    const forbidden = await request(app).delete(`/api/files/${adminFile.body.id}`).set(headers("client", "client-1"));
    expect(forbidden.status).toBe(403);
    const ownDelete = await request(app).delete(`/api/files/${clientFile.body.id}`).set(headers("client", "client-1"));
    expect(ownDelete.status).toBe(200);
  });

  it("separates file access between client and assigned subcontractor audiences", async () => {
    const app = createApp(new MemoryDataStore());
    const clientOnly = await request(app).post("/api/files").set(headers("admin", "admin-1")).send({ projectId: "project-1", jobIds: ["job-1"], name: "Client only.txt", mimeType: "text/plain", contentBase64: Buffer.from("client").toString("base64"), category: "Other", description: "", visibility: "client" });
    const subcontractorOnly = await request(app).post("/api/files").set(headers("admin", "admin-1")).send({ projectId: "project-1", jobIds: ["job-1"], name: "Subcontractor only.txt", mimeType: "text/plain", contentBase64: Buffer.from("subcontractor").toString("base64"), category: "Other", description: "", visibility: "assigned_subcontractor" });

    const clientData = await request(app).get("/api/bootstrap").set(headers("client", "client-1"));
    const subcontractorData = await request(app).get("/api/bootstrap").set(headers("subcontractor", "contractor-1"));
    expect(clientData.body.files.map((file: { id: string }) => file.id)).toContain(clientOnly.body.id);
    expect(clientData.body.files.map((file: { id: string }) => file.id)).not.toContain(subcontractorOnly.body.id);
    expect(subcontractorData.body.files.map((file: { id: string }) => file.id)).toContain(subcontractorOnly.body.id);
    expect(subcontractorData.body.files.map((file: { id: string }) => file.id)).not.toContain(clientOnly.body.id);

    expect((await request(app).get(`/api/files/${clientOnly.body.id}/download`).set(headers("subcontractor", "contractor-1"))).status).toBe(403);
    expect((await request(app).get(`/api/files/${subcontractorOnly.body.id}/download`).set(headers("client", "client-1"))).status).toBe(403);
  });

  it("opens invoice files for the submitting subcontractor and authorized staff", async () => {
    const app = createApp(new MemoryDataStore());
    const created = await request(app).post("/api/pay-requests").set(headers("subcontractor", "contractor-1")).send({ projectId: "project-1", jobId: "job-1", amountRequested: 500, invoiceNumber: "INV-OPEN-1", invoiceDate: "2026-09-01", description: "Test invoice", invoice: { name: "invoice.txt", mimeType: "text/plain", contentBase64: Buffer.from("invoice contents").toString("base64") }, attachments: [] });
    expect(created.status).toBe(201);
    const path = `/api/pay-requests/${created.body.id}/files/${created.body.invoice.id}/preview`;
    expect((await request(app).get(path).set(headers("subcontractor", "contractor-1"))).status).toBe(200);
    expect((await request(app).get(path).set(headers("admin", "admin-1"))).status).toBe(200);
    expect((await request(app).get(path).set(headers("client", "client-1"))).status).toBe(403);
  });

  it("persists project spending and deletes a project invoice", async () => {
    const app = createApp(new MemoryDataStore());
    const expense = await request(app).post("/api/project-expenses").set(headers("admin", "admin-1")).send({ projectId: "project-1", category: "Materials", description: "Concrete supplies", amount: 1250, spentOn: "2026-09-01" });
    expect(expense.status).toBe(201);
    const afterExpense = await request(app).get("/api/bootstrap").set(headers("admin", "admin-1"));
    expect(afterExpense.body.projectExpenses.some((item: { id: string }) => item.id === expense.body.id)).toBe(true);

    const invoice = await request(app).post("/api/projects/project-1/invoice-log").set(headers("admin", "admin-1")).send({ invoiceNumber: "PROJECT-DELETE-1", invoiceDate: "2026-09-01", amount: 800, description: "Supplier invoice" });
    expect(invoice.status).toBe(201);
    expect((await request(app).delete(`/api/projects/project-1/invoice-log/${invoice.body.id}`).set(headers("admin", "admin-1"))).status).toBe(200);
    const afterDelete = await request(app).get("/api/bootstrap").set(headers("admin", "admin-1"));
    expect(afterDelete.body.projectInvoiceLogs.some((item: { id: string }) => item.id === invoice.body.id)).toBe(false);
  });

  it("persists edited client information and serves fresh portal data", async () => {
    const app = createApp(new MemoryDataStore());
    const updated = await request(app).patch("/api/projects/project-1/client-contact").set(headers("admin", "admin-1")).send({ name: "Updated Tanner Family", email: "updated.tanner@example.com", phone: "555-555-0100", contractCost: 345000 });
    expect(updated.status).toBe(200);
    const bootstrap = await request(app).get("/api/bootstrap").set(headers("admin", "admin-1"));
    expect(bootstrap.headers["cache-control"]).toContain("no-store");
    expect(bootstrap.body.projects.find((item: { id: string }) => item.id === "project-1").clientName).toBe("Updated Tanner Family");
    expect(bootstrap.body.clients.find((item: { id: string }) => item.id === "client-1").email).toBe("updated.tanner@example.com");
    expect(bootstrap.body.users.find((item: { id: string }) => item.id === "client-1").email).not.toBe("updated.tanner@example.com");
  });
});
