export type Role = "admin" | "client" | "subcontractor";

export type JobStatus = "planned" | "scheduled" | "in_progress" | "blocked" | "complete";
export type ProjectStatus = "active" | "on_hold" | "complete";
export type ContractStatus = "draft" | "ready" | "sent" | "signed" | "failed";

export interface StageOption {
  name: string;
  percent: number;
}

export interface PortalSettings {
  companyName: string;
  supportEmail: string;
  senderName: string;
  contractPrefix: string;
  paymentTerms: string;
  esignProvider: "demo" | "docusign";
  contractTemplate: string;
  stages: StageOption[];
}

export interface Client {
  id: string;
  name: string;
  email: string;
  company?: string;
}

export interface Contractor {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company: string;
  trade: string;
}

export interface Project {
  id: string;
  number: string;
  name: string;
  address: string;
  clientId: string;
  clientName: string;
  manager: string;
  budget: number;
  progress: number;
  currentStage: string;
  startDate: string;
  targetDate: string;
  status: ProjectStatus;
}

export interface Job {
  id: string;
  projectId: string;
  number: string;
  title: string;
  scope: string;
  location: string;
  price: number;
  stage: string;
  progress: number;
  status: JobStatus;
  scheduleStart?: string;
  scheduleEnd?: string;
  contractorId?: string;
  contractorName?: string;
  interestOpen: boolean;
  bidDue?: string;
}

export interface Contract {
  id: string;
  jobId: string;
  projectId: string;
  contractorId: string;
  contractNumber: string;
  price: number;
  paymentTerms: string;
  notes: string;
  status: ContractStatus;
  pdfPath: string;
  envelopeId?: string;
  signingUrl?: string;
  deliveryError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InterestSubmission {
  id: string;
  jobId: string;
  contractorId: string;
  contractorName: string;
  contractorEmail: string;
  phone: string;
  availability: string;
  notes: string;
  status: "new" | "reviewing" | "accepted" | "declined";
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  actorRole: Role;
  createdAt: string;
}

export interface PortalData {
  settings: PortalSettings;
  clients: Client[];
  contractors: Contractor[];
  projects: Project[];
  jobs: Job[];
  contracts: Contract[];
  interests: InterestSubmission[];
  audit: AuditEntry[];
}

export interface BootstrapPayload extends PortalData {
  viewer: {
    role: Role;
    id: string;
    name: string;
  };
}
