import type { PortalData } from "../src/types.js";

const today = new Date();
const year = today.getFullYear();
const inDays = (days: number) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const seedData: PortalData = {
  settings: {
    companyName: "BullShark Contracting",
    supportEmail: "operations@bullsharkconnected.org",
    senderName: "BullShark Operations",
    contractPrefix: `BSC-${year}`,
    paymentTerms: "Net 30 after approved milestone completion",
    esignProvider: "demo",
    stages: [
      { name: "Preconstruction", percent: 5 },
      { name: "Sitework", percent: 15 },
      { name: "Foundation", percent: 30 },
      { name: "Framing", percent: 50 },
      { name: "Dry-in", percent: 65 },
      { name: "MEP rough-in", percent: 78 },
      { name: "Finishes", percent: 92 },
      { name: "Final inspection", percent: 98 },
      { name: "Complete", percent: 100 },
    ],
    contractTemplate: `SUBCONTRACTOR SERVICES AGREEMENT

Contract {{contractNumber}}

This agreement is between BullShark Contracting ("BullShark") and {{contractorName}} of {{contractorCompany}} ("Subcontractor") for work on {{projectName}}.

JOB AND SCOPE
Job {{jobNumber}} — {{jobTitle}}
Location: {{location}}
Scope: {{scope}}

PRICE AND PAYMENT
Contract price: {{price}}
Payment terms: {{paymentTerms}}

SCHEDULE
The planned field dates are {{scheduleStart}} through {{scheduleEnd}}. Subcontractor will coordinate changes with BullShark before mobilization.

TERMS
Subcontractor will perform the scope in a professional manner, maintain required insurance and licensing, follow site safety requirements, and promptly report conditions affecting cost or schedule. Changes require written approval from BullShark. This agreement and approved change orders represent the full scope of the parties' agreement.

{{notes}}`,
  },
  clients: [
    { id: "client-1", name: "Bubba Orgeron", email: "bubba@example.com" },
    { id: "client-2", name: "Elena Navarro", email: "elena@example.com" },
  ],
  contractors: [
    {
      id: "contractor-1",
      name: "Juan Alfaro",
      email: "juan@example.com",
      phone: "(210) 555-0148",
      company: "Alfaro Concrete",
      trade: "Concrete",
    },
    {
      id: "contractor-2",
      name: "Drew Martin",
      email: "drew@example.com",
      phone: "(830) 555-0182",
      company: "Hill Country Steel",
      trade: "Steel erection",
    },
    {
      id: "contractor-3",
      name: "Nia Brooks",
      email: "nia@example.com",
      phone: "(512) 555-0131",
      company: "Bluebonnet Framing",
      trade: "Framing",
    },
  ],
  projects: [
    {
      id: "project-1",
      number: `BS-${year}-0006`,
      name: "Orgeron Barndominium",
      address: "Cut Off, Louisiana",
      clientId: "client-1",
      clientName: "Bubba Orgeron",
      manager: "Marcella Johnson",
      budget: 267000,
      progress: 30,
      currentStage: "Foundation",
      startDate: inDays(-14),
      targetDate: inDays(150),
      status: "active",
    },
    {
      id: "project-2",
      number: `BS-${year}-0004`,
      name: "Navarro Workshop & Home",
      address: "200 W Pompano, Rockport, Texas",
      clientId: "client-2",
      clientName: "Elena Navarro",
      manager: "Marcella Johnson",
      budget: 340000,
      progress: 15,
      currentStage: "Sitework",
      startDate: inDays(7),
      targetDate: inDays(220),
      status: "active",
    },
  ],
  jobs: [
    {
      id: "job-1",
      projectId: "project-1",
      number: `BS-${year}-0006-J01`,
      title: "Foundation package",
      scope: "Form, reinforce, and place slab foundation per approved plans.",
      location: "Cut Off, Louisiana",
      price: 28600,
      stage: "Foundation",
      progress: 55,
      status: "in_progress",
      scheduleStart: inDays(2),
      scheduleEnd: inDays(6),
      contractorId: "contractor-1",
      contractorName: "Alfaro Concrete",
      interestOpen: false,
    },
    {
      id: "job-2",
      projectId: "project-1",
      number: `BS-${year}-0006-J02`,
      title: "Structural framing",
      scope: "Exterior and interior wall framing, roof trusses, and blocking.",
      location: "Cut Off, Louisiana",
      price: 86000,
      stage: "Framing",
      progress: 0,
      status: "planned",
      scheduleStart: inDays(15),
      scheduleEnd: inDays(30),
      interestOpen: true,
      bidDue: inDays(8),
    },
    {
      id: "job-3",
      projectId: "project-1",
      number: `BS-${year}-0006-J03`,
      title: "Steel building erection",
      scope: "Erect pre-engineered steel package, girts, purlins, roof, and wall panels.",
      location: "Cut Off, Louisiana",
      price: 124000,
      stage: "Dry-in",
      progress: 0,
      status: "planned",
      interestOpen: true,
      bidDue: inDays(14),
    },
    {
      id: "job-4",
      projectId: "project-2",
      number: `BS-${year}-0004-J01`,
      title: "Site clearing & utilities",
      scope: "Clear building pad, rough grade, and install underground service sleeves.",
      location: "Rockport, Texas",
      price: 32500,
      stage: "Sitework",
      progress: 35,
      status: "scheduled",
      scheduleStart: inDays(9),
      scheduleEnd: inDays(13),
      contractorId: "contractor-2",
      contractorName: "Hill Country Steel",
      interestOpen: false,
    },
  ],
  contracts: [],
  interests: [],
  audit: [
    {
      id: "audit-seed",
      action: "Portal initialized",
      detail: "Projects, jobs, and role workspaces created.",
      actorRole: "admin",
      createdAt: new Date().toISOString(),
    },
  ],
};
