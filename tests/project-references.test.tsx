import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../server/app.js";
import { MemoryDataStore } from "../server/store.js";
import { seedData } from "../server/seed.js";
import { YardageReferenceSheet } from "../src/components";

vi.mock("../src/api", () => ({ api: { mutate: vi.fn() } }));

const admin = { "x-user-role": "admin", "x-user-id": "admin-1" };
describe("Supplier edits and project references", () => {
  it("renames a supplier by identity and preserves linked concrete sheets", async () => {
    const store = new MemoryDataStore(); const app = createApp(store);
    const supplier = await request(app).post("/api/yardage/suppliers").set(admin).send({ company: "Original", phone: "1234567890" });
    const input = { status: "ACTIVE", concreteCompany: "Original", client: "Test", projectId: seedData.projects[0].id, dimensions: "30x40", thickness: 6, footers: "12x12" };
    const first = await request(app).post("/api/yardage").set(admin).send({ ...input, label: "Main slab" });
    const second = await request(app).post("/api/yardage").set(admin).send({ ...input, label: "Porch" });
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    const edited = await request(app).patch(`/api/yardage/suppliers/${supplier.body.id}`).set(admin).send({ company: "Renamed", notes: "Call before delivery" });
    expect(edited.status).toBe(200); expect(edited.body.id).toBe(supplier.body.id);
    const state = await store.read(); expect(state.concreteSuppliers).toHaveLength(1);
    expect(state.yardageRows?.every((row) => row.concreteCompany === "Renamed")).toBe(true);
    const html = renderToStaticMarkup(<YardageReferenceSheet project={seedData.projects[0]} rows={state.yardageRows || []} />);
    expect(html).toContain("Main slab"); expect(html).toContain("Porch");
    const renamed = await request(app).patch(`/api/yardage/${first.body.id}`).set(admin).send({ label: "Garage" });
    expect(renamed.body.label).toBe("Garage"); expect(renamed.body.finalOrderYardage).toBe(first.body.finalOrderYardage);
    const denied = await request(app).patch(`/api/yardage/suppliers/${supplier.body.id}`).set({ "x-user-role": "client", "x-user-id": "client-1" }).send({ company: "Denied" });
    expect(denied.status).toBe(403);
  });
  it("persists material lists when editing a job", async () => {
    const store = new MemoryDataStore(); const app = createApp(store); const job = (await store.read()).jobs[0];
    const saved = await request(app).patch(`/api/jobs/${job.id}`).set(admin).send({ ...job, materialList: "20 pieces #4 rebar\n30 CY concrete" });
    expect(saved.status).toBe(200); expect((await store.read()).jobs[0].materialList).toBe("20 pieces #4 rebar\n30 CY concrete");
  });
});
