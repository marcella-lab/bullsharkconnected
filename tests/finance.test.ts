import { describe, expect, it } from "vitest";
import { projectFinancialValues } from "../src/FinancePage";
import type { BootstrapPayload, YardageRow } from "../src/types";

const row = {
  id: "yardage-1",
  client: "Tommy Johns",
  concreteCost: 0,
  subCost: 0,
  additionalCosts: 0,
  contractCost: 0,
} as YardageRow;

describe("project financial values", () => {
  it("populates contract cost and categorized project spending", () => {
    const data = {
      projects: [{ id: "project-1", name: "Johns Shop", clientName: "Tommy Johns", budget: 20_000 }],
      projectExpenses: [
        { projectId: "project-1", category: "LABOR", amount: 10_000 },
        { projectId: "project-1", category: "Concrete", amount: 5_647 },
      ],
    } as unknown as BootstrapPayload;

    expect(projectFinancialValues(row, data)).toEqual({
      concreteCost: 5_647,
      subCost: 10_000,
      additionalCosts: 0,
      contractCost: 20_000,
      connected: true,
    });
  });

  it("keeps manual amounts when a calculator row is not connected to a project", () => {
    const manual = { ...row, client: "Unmatched", concreteCost: 1200, subCost: 800, additionalCosts: 50, contractCost: 4000 };
    const data = { projects: [], projectExpenses: [] } as unknown as BootstrapPayload;

    expect(projectFinancialValues(manual, data)).toEqual({
      concreteCost: 1200,
      subCost: 800,
      additionalCosts: 50,
      contractCost: 4000,
      connected: false,
    });
  });
});
