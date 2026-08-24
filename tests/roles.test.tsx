// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
