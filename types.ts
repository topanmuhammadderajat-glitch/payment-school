export type SchoolLevel = 'TK' | 'SD' | 'SMP' | 'SMA';

export type FeeCategory = 'spp' | 'daftar_ulang' | 'jemputan' | 'manual';

export type TemplateCategory = 'spp' | 'daftar_ulang' | 'jemputan';

export type PaymentMethod = 'none' | 'cash' | 'va' | 'qris' | 'bank_transfer';

export type ActivePaymentMethod = 'cash' | 'va' | 'qris' | 'bank_transfer';

export type InvoiceStatus = 'unpaid' | 'pending_payment' | 'paid';

export type TransactionStatus = 'pending' | 'settled' | 'cancelled';

export type PortalRole = 'super_admin' | 'school_finance' | 'parent' | 'unassigned';

export const ALL_SCHOOL_LEVELS: SchoolLevel[] = ['TK', 'SD', 'SMP', 'SMA'];

export const LEVEL_LABELS: Record<SchoolLevel, string> = {
  TK: 'TK / PAUD',
  SD: 'SD / MI',
  SMP: 'SMP / MTs',
  SMA: 'SMA / SMK / MA',
};

export const LEVEL_GRADES: Record<SchoolLevel, string[]> = {
  TK: ['TK A', 'TK B'],
  SD: ['Kelas 1', 'Kelas 2', 'Kelas 3', 'Kelas 4', 'Kelas 5', 'Kelas 6'],
  SMP: ['Kelas 7', 'Kelas 8', 'Kelas 9'],
  SMA: ['Kelas 10', 'Kelas 11', 'Kelas 12'],
};

export interface EnabledModules {
  spp: boolean;
  daftarUlang: boolean;
  jemputan: boolean;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface School {
  id: string;
  name: string;
  code: string;
  npsn?: string;
  address?: string;
  city?: string;
  phone?: string;
  principalName?: string;
  treasurerName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  status: 'active' | 'inactive';
  enabledLevels: SchoolLevel[];
  enabledModules: EnabledModules;
  adminEmails: string[];
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SchoolRequest {
  id: string;
  schoolName: string;
  city: string;
  contactEmail: string;
  contactPhone?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  requestedLevels: SchoolLevel[];
  requestedModules: EnabledModules;
  applicantUid: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FeeTemplate {
  id: string;
  schoolId: string;
  authorizedFinanceEmails: string[];
  category: TemplateCategory;
  name: string;
  level: SchoolLevel | 'ALL';
  grade: string;
  amount: number;
  billingCycle: 'monthly' | 'annual' | 'one_time';
  isActive: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Student {
  id: string;
  schoolId: string;
  schoolName: string;
  authorizedFinanceEmails: string[];
  nis: string;
  name: string;
  level: SchoolLevel;
  grade: string;
  className?: string;
  parentName: string;
  parentEmail: string;
  parentPhone?: string;
  useShuttle: boolean;
  shuttleZone?: string;
  customSppAmount: number;
  customShuttleAmount: number;
  status: 'active' | 'graduated' | 'inactive';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Invoice {
  id: string;
  schoolId: string;
  schoolName: string;
  authorizedFinanceEmails: string[];
  studentId: string;
  studentNis: string;
  studentName: string;
  studentLevel: SchoolLevel;
  studentGrade: string;
  parentEmail: string;
  parentName: string;
  category: FeeCategory;
  title: string;
  period: string;
  amount: number;
  paidAmount?: number;
  dueDate: string;
  notes?: string;
  status: InvoiceStatus;
  paymentMethod: PaymentMethod;
  paymentChannel?: string;
  schoolBankName?: string;
  schoolBankAccountNumber?: string;
  schoolBankAccountHolder?: string;
  receiptNumber?: string;
  transactionId?: string;
  paidAt?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Transaction {
  id: string;
  schoolId: string;
  schoolName: string;
  authorizedFinanceEmails: string[];
  studentId: string;
  studentNis: string;
  studentName: string;
  studentLevel: SchoolLevel;
  studentGrade: string;
  parentEmail: string;
  parentName: string;
  invoiceIds: string[];
  invoiceTitles: string[];
  categories: string[];
  totalAmount: number;
  method: ActivePaymentMethod;
  channelDetail: string;
  vaNumber?: string;
  vaBillerCode?: string;
  qrisPayload?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  transferSenderName?: string;
  transferReference?: string;
  transferProofDataUrl?: string;
  gatewayProvider?: string;
  gatewayOrderId?: string;
  gatewayTransactionId?: string;
  expiresAt?: string;
  receiptNumber: string;
  notes?: string;
  status: TransactionStatus;
  payerUid: string;
  payerEmail: string;
  settledByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  settledAt?: string;
}
