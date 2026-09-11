// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionMenu } from "../src/components";
import { Layout } from "../src/Layout";
import { SubcontractorPages } from "../src/RolePages";
import type { BootstrapPayload } from "../src/types";

afterEach(cleanup);

describe("role navigation", () => {
  const subcontractorData = (view: string) => ({
    viewer: { id: "sub-1", role: "subcontractor", name: "Field Crew" },
    users: [{ id: "sub-1", jobIds: ["complete-job", "scheduled-job"] }],
    jobs: [
      { id: "complete-job", projectId: "project-1", number: "JOB-1", title: "Completed job", status: "complete", progress: 100, scheduleStart: "2026-09-01", scheduleEnd: "2026-09-03", stage: "Foundation", price: 5000 },
      { id: "scheduled-job", projectId: "project-1", number: "JOB-2", title: "Scheduled job", status: "scheduled", progress: 0, scheduleStart: "2026-09-14", scheduleEnd: "2026-09-16", stage: "Foundation", price: 7000 },
    ],
    projects: [{ id: "project-1", name: "Sample project", address: "1 Main St" }],
    contracts: [], yardageRows: [], files: [],
  } as unknown as BootstrapPayload);
  const noopMutate = async <T,>(): Promise<T> => undefined as T;

  it("limits client navigation to their read-only project view", () => {
    render(<Layout role="client" viewerName="Bubba Orgeron" view="overview" onViewChange={() => undefined} onRoleChange={() => undefined}><div>Client content</div></Layout>);
    expect(screen.getByText("My project")).toBeTruthy();
    expect(screen.queryByText("Job schedule")).toBeNull();
    expect(screen.queryByText("Invoices")).toBeNull();
    expect(screen.queryByText("Estimator")).toBeNull();
  });

  it("provides a dedicated subcontractor workspace", () => {
    render(<Layout role="subcontractor" viewerName="Juan Alfaro" view="overview" onViewChange={() => undefined} onRoleChange={() => undefined}><div>Subcontractor content</div></Layout>);
    expect(screen.getByText("My jobs")).toBeTruthy();
    expect(screen.getByText("Potential jobs")).toBeTruthy();
  });

  it("keeps completed subcontractor jobs at the bottom and off the schedule", () => {
    const data = subcontractorData("jobs");
    const { rerender } = render(<SubcontractorPages data={data} view="jobs" mutate={noopMutate} />);
    const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(titles.indexOf("Scheduled job")).toBeLessThan(titles.indexOf("Completed job"));

    rerender(<SubcontractorPages data={subcontractorData("schedule")} view="schedule" mutate={noopMutate} />);
    expect(screen.getByText("Scheduled job")).toBeTruthy();
    expect(screen.queryByText("Completed job")).toBeNull();
  });

  it("closes an open card menu when a different card menu is opened", () => {
    render(<><ActionMenu label="Project file actions" items={[{ label: "Add files", onSelect: () => undefined }]} /><ActionMenu label="Actions for plan.pdf" items={[{ label: "Edit", onSelect: () => undefined }, { label: "Delete", onSelect: () => undefined }]} /></>);
    fireEvent.click(screen.getByLabelText("Project file actions"));
    expect(screen.getByText("Add files")).toBeTruthy();
    const fileMenu = screen.getByLabelText("Actions for plan.pdf");
    fireEvent.mouseDown(fileMenu);
    fireEvent.click(fileMenu);
    expect(screen.queryByText("Add files")).toBeNull();
    expect(screen.getByText("Edit")).toBeTruthy();
  });
});
