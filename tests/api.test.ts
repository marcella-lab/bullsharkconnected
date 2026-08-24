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
});
