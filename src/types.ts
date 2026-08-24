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

export type PayRequestStatus = "submitted" | "under_review" | "approved" | "partially_approved" | "payment_processing" | "paid" | "rejected" | "needs_revision";
export type FileVisibility = "admin" | "client" | "assigned_subcontractor" | "client_and_assigned_subcontractor" | "project_access";

export interface PortalUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  trade?: string;
  active: boolean;
  mustChangePassword: boolean;
  passwordHash: string;
  lastLoginAt?: string;
  projectIds: string[];
  jobIds: string[];
  notificationPreferences: Record<string, { inApp: boolean; email: boolean; sms: boolean; locked?: boolean }>;
}

export interface PortalFile {
  id: string;
  projectId: string;
  jobIds: string[];
  name: string;
  mimeType: string;
  size: number;
  path: string;
  visibility: FileVisibility;
  uploadedBy: string;
  createdAt: string;
}

export interface PayRequestAttachment { id: string; name: string; mimeType: string; path: string; size: number; }
export interface PayRequestEvent { id: string; action: string; actorId: string; actorName: string; createdAt: string; note?: string; }
export interface PayRequest {
  id: string; projectId: string; jobId: string; subcontractorId: string; subcontractorName: string; company: string;
  amountRequested: number; approvedAmount?: number; invoiceNumber: string; invoiceDate: string; description: string;
  invoice: PayRequestAttachment; attachments: PayRequestAttachment[]; status: PayRequestStatus; adminNotes?: string;
  paymentDate?: string; paymentReference?: string; readByAdmin: boolean; createdAt: string; updatedAt: string; activity: PayRequestEvent[];
}

export interface PotentialJob {
  id: string; projectId: string; title: string; trade: string; scope: string; location: string;
  estimatedStartDate?: string; estimatedCompletionDate?: string; bidDue?: string; budget?: number; notes?: string;
  visibleTo: "all" | "trade" | "specific"; contractorIds: string[]; fileIds: string[]; status: "open" | "awarded" | "closed"; createdAt: string;
}
export interface Bid { id: string; potentialJobId: string; contractorId: string; contractorName: string; amount: number; duration: string; proposedStartDate?: string; comments?: string; fileIds: string[]; status: "interested" | "submitted" | "selected" | "declined"; createdAt: string; updatedAt: string; }
export interface PortalMessage { id: string; contextType: "project" | "job" | "potential_job" | "pay_request"; contextId: string; senderId: string; recipientIds: string[]; body: string; attachmentIds: string[]; readBy: string[]; createdAt: string; }
export interface Notification { id: string; userId: string; type: string; title: string; detail: string; href: string; readAt?: string; priority: "normal" | "high"; createdAt: string; }

export interface PortalData {
  settings: PortalSettings;
  clients: Client[];
  contractors: Contractor[];
  projects: Project[];
  jobs: Job[];
  contracts: Contract[];
  interests: InterestSubmission[];
  audit: AuditEntry[];
  users?: PortalUser[];
  files?: PortalFile[];
  payRequests?: PayRequest[];
  potentialJobs?: PotentialJob[];
  bids?: Bid[];
  messages?: PortalMessage[];
  notifications?: Notification[];
}

export interface BootstrapPayload extends PortalData {
  viewer: {
    role: Role;
    id: string;
    name: string;
  };
}
