export type Role = "admin" | "project_manager" | "client" | "subcontractor";

export type JobStatus = "planned" | "scheduled" | "in_progress" | "blocked" | "on_hold" | "complete";
export type ProjectWorkStatus = "new" | "lost" | "scheduled" | "in_progress" | "completed";
export type ProjectStatus = "active" | "on_hold" | "complete";
export interface ProjectMilestone {
  id: string;
  title: string;
  date: string;
  details?: string;
  createdAt: string;
}
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
  companyAddress?: string;
  companyPhone?: string;
  companyWebsite?: string;
  defaultClientMessage?: string;
  defaultSubcontractorMessage?: string;
  scheduleDays?: number;
  weekendWorkAllowed?: boolean;
  notificationRules?: Record<string, { inApp: boolean; sms: boolean; email: boolean }>;
  clientPortal?: { schedule: boolean; files: boolean; photos: boolean; progress: boolean };
  subcontractorPortal?: { sharedFiles: boolean; schedule: boolean; projectAddress: boolean; payRequests: boolean };
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
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
  /** Project-only contact details. They never control portal access. */
  clientContactName?: string;
  clientContactEmail?: string;
  clientContactPhone?: string;
  /** Administrator-controlled position in the Projects & jobs card board. */
  displayOrder?: number;
  manager: string;
  budget: number;
  progress: number;
  currentStage: string;
  startDate: string;
  targetDate: string;
  status: ProjectStatus;
  workStatus?: ProjectWorkStatus;
  fieldNotes?: string;
  milestones?: ProjectMilestone[];
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
  clientId?: string;
  clientName?: string;
  interestOpen: boolean;
  bidDue?: string;
  laborCost?: number;
  privateNotes?: string;
  subcontractorInstructions?: string;
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
  signerName?: string;
  signerTitle?: string;
  signedAt?: string;
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
  firstName?: string;
  lastName?: string;
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
  category?: string;
  description?: string;
  captureDate?: string;
  capturedToday?: boolean;
  geoLatitude?: number;
  geoLongitude?: number;
}

export interface PayRequestAttachment { id: string; name: string; mimeType: string; path: string; size: number; }
export interface PayRequestEvent { id: string; action: string; actorId: string; actorName: string; createdAt: string; note?: string; }
export interface PayRequest {
  id: string; projectId: string; jobId: string; subcontractorId: string; subcontractorName: string; company: string;
  amountRequested: number; approvedAmount?: number; invoiceNumber: string; invoiceDate: string; description: string;
  invoice: PayRequestAttachment; attachments: PayRequestAttachment[]; status: PayRequestStatus; adminNotes?: string;
  paymentDate?: string; paymentReference?: string; readByAdmin: boolean; createdAt: string; updatedAt: string; activity: PayRequestEvent[];
}
export interface ClientInvoice { id: string; projectId: string; clientId: string; invoiceNumber: string; invoiceDate: string; dueDate?: string; amount: number; description: string; status: "draft" | "sent" | "paid" | "void"; createdAt: string; updatedAt: string; }
export interface ProjectInvoiceLog { id: string; projectId: string; invoiceNumber: string; invoiceDate: string; amount: number; description?: string; fileId?: string; fileName?: string; purchasedByContractorId?: string; purchasedByContractorName?: string; createdBy: string; createdByName: string; createdAt: string; }
export interface ProjectExpense { id: string; projectId: string; category: string; description: string; amount: number; spentOn: string; createdAt: string; createdBy: string; }

export interface PotentialJob {
  id: string; projectId: string; title: string; trade: string; scope: string; location: string;
  estimatedStartDate?: string; estimatedCompletionDate?: string; bidDue?: string; budget?: number; notes?: string;
  visibleTo: "all" | "trade" | "specific"; contractorIds: string[]; fileIds: string[]; status: "open" | "awarded" | "closed"; createdAt: string;
}
export interface Bid { id: string; potentialJobId: string; contractorId: string; contractorName: string; amount: number; duration: string; proposedStartDate?: string; comments?: string; fileIds: string[]; status: "interested" | "submitted" | "selected" | "declined"; createdAt: string; updatedAt: string; }
export interface PortalMessage { id: string; contextType: "project" | "job" | "potential_job" | "pay_request"; contextId: string; senderId: string; recipientIds: string[]; body: string; attachmentIds: string[]; readBy: string[]; createdAt: string; }
export interface Notification { id: string; userId: string; type: string; title: string; detail: string; href: string; readAt?: string; priority: "normal" | "high"; createdAt: string; }
export type YardageStatus = "ACTIVE" | "INACTIVE" | "POTENTIAL" | "COMPLETED";
export interface YardageRow { id: string; status: YardageStatus; state: string; concreteCompany: string; client: string; projectId?: string; dimensions: string; thickness: number; footers: string; length: number; width: number; footerWidth: number; footerDepth: number; slabSquareFeet: number; slabYardage: number; footerYardage: number; totalYardage: number; additionalConcreteYardage: number; wasteOverageYardage: number; finalOrderYardage: number; /* retained for existing saved rows */ padYardage?: number; concreteCost: number; subCost: number; contractCost: number; additionalCosts: number; notes?: string; createdAt: string; updatedAt: string; createdBy: string; updatedBy: string; }
export interface ConcreteSupplier { id: string; company: string; supplierType?: string; contactName?: string; phone?: string; email?: string; state?: string; notes?: string; }

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
  clientInvoices?: ClientInvoice[];
  projectInvoiceLogs?: ProjectInvoiceLog[];
  projectExpenses?: ProjectExpense[];
  potentialJobs?: PotentialJob[];
  bids?: Bid[];
  messages?: PortalMessage[];
  notifications?: Notification[];
  yardageRows?: YardageRow[];
  concreteSuppliers?: ConcreteSupplier[];
}

export interface BootstrapPayload extends PortalData {
  viewer: {
    role: Role;
    id: string;
    name: string;
  };
}
