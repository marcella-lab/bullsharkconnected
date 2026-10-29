import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.js";
import { MemoryDataStore } from "../server/store.js";
const admin = { "x-user-role": "admin", "x-user-id": "admin-1" };
it("assigns multiple suppliers to projects independently and cleans up deleted assignments", async () => {
  const store = new MemoryDataStore(); const app = createApp(store); const projects = (await store.read()).projects;
  const a = (await request(app).post("/api/yardage/suppliers").set(admin).send({ company: "Supplier A" })).body;
  const b = (await request(app).post("/api/yardage/suppliers").set(admin).send({ company: "Supplier B" })).body;
  const assign = (id: string, ids: string[]) => request(app).patch(`/api/yardage/suppliers/${id}/projects`).set(admin).send({ projectIds: ids });
  expect((await assign(a.id, projects.map((project) => project.id))).status).toBe(200);
  expect((await assign(b.id, [projects[0].id])).status).toBe(200);
  expect((await store.read()).projects[0].supplierIds).toEqual([a.id, b.id]);
  expect((await assign(a.id, [])).status).toBe(200);
  expect((await store.read()).projects[0].supplierIds).toEqual([b.id]);
  expect((await assign(b.id, ["missing"])).status).toBe(400);
  expect((await store.read()).projects[0].supplierIds).toEqual([b.id]);
  const job = (await store.read()).jobs[0];
  await request(app).patch(`/api/jobs/${job.id}/suppliers`).set(admin).send({ supplierIds: [b.id] });
  expect((await request(app).delete(`/api/yardage/suppliers/${b.id}`).set(admin)).status).toBe(200);
  const state = await store.read(); expect(state.projects[0].supplierIds).toEqual([]); expect(state.jobs[0].supplierIds).toEqual([]);
  expect(state.concreteSuppliers?.some((supplier) => supplier.id === a.id)).toBe(true);
});
it("restricts supplier deletion and project assignments to admins", async () => {
  const app = createApp(new MemoryDataStore());
  const headers = { "x-user-role": "client", "x-user-id": "client-1" };
  expect((await request(app).patch("/api/yardage/suppliers/any/projects").set(headers).send({ projectIds: [] })).status).toBe(403);
  expect((await request(app).delete("/api/yardage/suppliers/any").set(headers)).status).toBe(403);
});
