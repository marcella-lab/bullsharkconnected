import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { MemoryDataStore } from "../server/store.js";
const admin = { "x-user-role": "admin", "x-user-id": "admin-1" };

describe("Job supplier assignments", () => {
  it("saves multiple suppliers per job, preserves other jobs, and supports removal", async () => {
    const store = new MemoryDataStore(); const app = createApp(store);
    const before = await store.read(); const [job, other] = before.jobs;
    const first = await request(app).post("/api/yardage/suppliers").set(admin).send({ company: "Concrete supplier" });
    const second = await request(app).post("/api/yardage/suppliers").set(admin).send({ company: "Rebar supplier" });
    const supplierIds = [first.body.id, second.body.id];
    const saved = await request(app).patch(`/api/jobs/${job.id}/suppliers`).set(admin).send({ supplierIds: [...supplierIds, first.body.id] });
    expect(saved.status).toBe(200); expect(saved.body.supplierIds).toEqual(supplierIds);
    let state = await store.read(); expect(state.jobs.find((item) => item.id === job.id)?.supplierIds).toEqual(supplierIds);
    expect(state.jobs.find((item) => item.id === other.id)).toEqual(other);
    await request(app).patch(`/api/yardage/suppliers/${first.body.id}`).set(admin).send({ company: "Renamed supplier" });
    state = await store.read(); expect(state.jobs.find((item) => item.id === job.id)?.supplierIds).toEqual(supplierIds);
    const remove = await request(app).patch(`/api/jobs/${job.id}/suppliers`).set(admin).send({ supplierIds: [second.body.id] });
    expect(remove.body.supplierIds).toEqual([second.body.id]);
    const clear = await request(app).patch(`/api/jobs/${job.id}/suppliers`).set(admin).send({ supplierIds: [] });
    expect(clear.status).toBe(200); expect(clear.body.supplierIds).toEqual([]);
  });
  it("rejects unknown suppliers and unauthorized edits without changing assignments", async () => {
    const store = new MemoryDataStore(); const app = createApp(store); const job = (await store.read()).jobs[0];
    const invalid = await request(app).patch(`/api/jobs/${job.id}/suppliers`).set(admin).send({ supplierIds: ["missing"] });
    expect(invalid.status).toBe(400);
    const missing = await request(app).patch("/api/jobs/missing/suppliers").set(admin).send({ supplierIds: [] });
    expect(missing.status).toBe(404);
    for (const [role, id] of [["client", "client-1"], ["subcontractor", "contractor-1"]]) {
      const denied = await request(app).patch(`/api/jobs/${job.id}/suppliers`).set({ "x-user-role": role, "x-user-id": id }).send({ supplierIds: [] });
      expect(denied.status).toBe(403);
    }
    expect((await store.read()).jobs.find((item) => item.id === job.id)?.supplierIds).toEqual(job.supplierIds);
  });
});
