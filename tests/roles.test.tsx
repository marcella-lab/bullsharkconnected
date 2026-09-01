// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionMenu } from "../src/components";
import { Layout } from "../src/Layout";

afterEach(cleanup);

describe("role navigation", () => {
  it("shows the client schedule but no invoices or estimator view", () => {
    render(<Layout role="client" viewerName="Bubba Orgeron" view="overview" onViewChange={() => undefined} onRoleChange={() => undefined}><div>Client content</div></Layout>);
    expect(screen.getByText("Job schedule")).toBeTruthy();
    expect(screen.queryByText("Invoices")).toBeNull();
    expect(screen.queryByText("Estimator")).toBeNull();
  });

  it("provides a dedicated subcontractor workspace", () => {
    render(<Layout role="subcontractor" viewerName="Juan Alfaro" view="overview" onViewChange={() => undefined} onRoleChange={() => undefined}><div>Subcontractor content</div></Layout>);
    expect(screen.getByText("My jobs")).toBeTruthy();
    expect(screen.getByText("Potential jobs")).toBeTruthy();
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
