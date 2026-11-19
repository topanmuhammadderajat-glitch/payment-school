import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  Image as ImageIcon,
  Layers,
  MessageCircle,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ALL_SCHOOL_LEVELS,
  ActivePaymentMethod,
  EnabledModules,
  FeeCategory,
  FeeTemplate,
  Invoice,
  LEVEL_GRADES,
  School,
  SchoolLevel,
  Student,
  TemplateCategory,
  Transaction,
} from '../types';
import {
  ACTIVE_METHOD_LABELS,
  CATEGORY_LABELS,
  INDONESIAN_BANKS,
  STATUS_LABELS,
  buildWhatsAppReminder,
  formatDateId,
  formatDateTimeId,
  formatPeriodLabel,
  formatRupiah,
  generateSafeId,
  getCurrentPeriodValue,
  getInvoicePaidAmount,
  getInvoiceRemainingAmount,
  getMonthPeriodOptions,
  getNextGradePromotion,
  normalizeEmail,
} from '../utils/formatters';
import {
  GatewayConfig,
  cancelDigitalPayment,
  checkMidtransPaymentStatus,
  fetchGatewayConfig,
  settleCashPayment,
  settleDigitalPayment,
} from '../utils/paymentService';
import {
  exportSchoolReportExcel,
  exportSchoolReportPdfA4,
} from '../utils/exporters';
import { ReceiptModal } from './ReceiptModal';
import { CheckoutModal } from './CheckoutModal';
import {
  AppShell,
  CircularProgressRing,
  PortalShellContext,
  ShellNavItem,
  ShellSecondaryItem,
} from './AppShell';
import { SchoolFinanceStatsOverview } from './SchoolFinanceStatsOverview';

interface ImportStudentRow {
  rowNum: number;
  nis: string;
  name: string;
  level: SchoolLevel;
  grade: string;
  className: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  useShuttle: boolean;
  shuttleZone: string;
  customSppAmount: number;
  error?: string;
}

interface SchoolFinancePortalProps {
  shell: PortalShellContext;
  school: School;
  userUid: string;
  userEmail: string;
  feeTemplates: FeeTemplate[];
  students: Student[];
  invoices: Invoice[];
  transactions: Transaction[];
  allSchools?: School[];
  onSwitchSchool?: (schoolId: string) => void;
}

type FinanceTab = 'overview' | 'settings' | 'students' | 'billing' | 'cashier' | 'reports';

export const SchoolFinancePortal: React.FC<SchoolFinancePortalProps> = ({
  shell,
  school,
  userUid,
  userEmail,
  feeTemplates,
  students,
  invoices,
  transactions,
  allSchools,
  onSwitchSchool,
}) => {
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');
  const [toastMsg, setToastMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [processingTxId, setProcessingTxId] = useState('');
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [counterCheckoutInvoices, setCounterCheckoutInvoices] = useState<Invoice[] | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const reportActionError = (err: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      setErrorMsg(
        wrapped instanceof Error ? wrapped.message : 'Terjadi kendala saat memproses data.',
      );
    }
  };

  // --- Settings & Tariff State ---
  const [schoolForm, setSchoolForm] = useState({
    name: school.name,
    npsn: school.npsn || '',
    address: school.address || '',
    city: school.city || '',
    phone: school.phone || '',
    principalName: school.principalName || '',
    treasurerName: school.treasurerName || '',
    bankName: school.bankName || '',
    bankAccountNumber: school.bankAccountNumber || '',
    bankAccountHolder: school.bankAccountHolder || '',
    enabledLevels: school.enabledLevels,
    enabledModules: school.enabledModules,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    fetchGatewayConfig()
      .then((cfg) => setGatewayConfig(cfg))
      .catch(() => setGatewayConfig(null));
  }, []);

  // Keep form synced when switching schools
  React.useEffect(() => {
    setSchoolForm({
      name: school.name,
      npsn: school.npsn || '',
      address: school.address || '',
      city: school.city || '',
      phone: school.phone || '',
      principalName: school.principalName || '',
      treasurerName: school.treasurerName || '',
      bankName: school.bankName || '',
      bankAccountNumber: school.bankAccountNumber || '',
      bankAccountHolder: school.bankAccountHolder || '',
      enabledLevels: school.enabledLevels,
      enabledModules: school.enabledModules,
    });
  }, [school]);

  // Tariff Modal State
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FeeTemplate | null>(null);
  const [tplCategory, setTplCategory] = useState<TemplateCategory>('spp');
  const [tplName, setTplName] = useState('');
  const [tplLevel, setTplLevel] = useState<SchoolLevel | 'ALL'>(school.enabledLevels[0] || 'SD');
  const [tplGrade, setTplGrade] = useState('');
  const [tplAmount, setTplAmount] = useState('');
  const [tplCycle, setTplCycle] = useState<'monthly' | 'annual' | 'one_time'>('monthly');

  // --- Student State ---
  const [studentSearch, setStudentSearch] = useState('');
  const [studentLevelFilter, setStudentLevelFilter] = useState<'all' | SchoolLevel>('all');
  const [studentStatusFilter, setStudentStatusFilter] = useState<'active' | 'graduated' | 'all'>('active');
  const [showStudentModal, setShowStudentModal] = useState(false);

  // Safe Delete Student State
  const [deleteStudentTarget, setDeleteStudentTarget] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);

  // Edit Invoice State
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editInvTitle, setEditInvTitle] = useState('');
  const [editInvPeriod, setEditInvPeriod] = useState('');
  const [editInvAmount, setEditInvAmount] = useState('');
  const [editInvDueDate, setEditInvDueDate] = useState('');
  const [editInvNotes, setEditInvNotes] = useState('');
  const [savingInvoiceEdit, setSavingInvoiceEdit] = useState(false);

  // Bulk Excel Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportStudentRow[]>([]);
  const [importingStudents, setImportingStudents] = useState(false);
  const [importFileError, setImportFileError] = useState('');

  // Mass Grade Promotion / Graduation State
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promoteLevel, setPromoteLevel] = useState<'ALL' | SchoolLevel>('ALL');
  const [promoteGrade, setPromoteGrade] = useState('ALL');
  const [promotingStudents, setPromotingStudents] = useState(false);

  // Proof Image Lightbox & WhatsApp Fallback Modal
  const [previewProofTx, setPreviewProofTx] = useState<Transaction | null>(null);
  const [waFallbackModal, setWaFallbackModal] = useState<{
    title: string;
    studentName: string;
    message: string;
  } | null>(null);
  const [copiedWaMsg, setCopiedWaMsg] = useState(false);

  useEffect(() => {
    const anyModalOpen =
      showTemplateModal ||
      showStudentModal ||
      Boolean(deleteStudentTarget) ||
      Boolean(editingInvoice) ||
      showImportModal ||
      showPromoteModal ||
      Boolean(previewProofTx) ||
      Boolean(waFallbackModal);
    if (!anyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTemplateModal(false);
        setShowStudentModal(false);
        setDeleteStudentTarget(null);
        setEditingInvoice(null);
        setShowImportModal(false);
        setShowPromoteModal(false);
        setPreviewProofTx(null);
        setWaFallbackModal(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    showTemplateModal,
    showStudentModal,
    deleteStudentTarget,
    editingInvoice,
    showImportModal,
    showPromoteModal,
    previewProofTx,
    waFallbackModal,
  ]);

  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [stuNis, setStuNis] = useState('');
  const [stuName, setStuName] = useState('');
  const [stuLevel, setStuLevel] = useState<SchoolLevel>(school.enabledLevels[0] || 'SD');
  const [stuGrade, setStuGrade] = useState(LEVEL_GRADES[school.enabledLevels[0] || 'SD'][0]);
  const [stuClassName, setStuClassName] = useState('');
  const [stuParentName, setStuParentName] = useState('');
  const [stuParentEmail, setStuParentEmail] = useState('');
  const [stuParentPhone, setStuParentPhone] = useState('');
  const [stuUseShuttle, setStuUseShuttle] = useState(false);
  const [stuShuttleZone, setStuShuttleZone] = useState('');
  const [stuCustomSpp, setStuCustomSpp] = useState('0');
  const [stuCustomShuttle, setStuCustomShuttle] = useState('0');
  const [stuStatus, setStuStatus] = useState<'active' | 'graduated' | 'inactive'>('active');
  const [savingStudent, setSavingStudent] = useState(false);

  // --- Billing State (Batch + Manual) ---
  const [billingMode, setBillingMode] = useState<'mass' | 'manual'>('mass');
  const [massCategory, setMassCategory] = useState<TemplateCategory>('spp');
  const [massPeriod, setMassPeriod] = useState(getCurrentPeriodValue());
  const [massTargetLevel, setMassTargetLevel] = useState<'ALL' | SchoolLevel>('ALL');
  const [massTargetGrade, setMassTargetGrade] = useState('ALL');
  const [massFallbackAmount, setMassFallbackAmount] = useState('500000');
  const [massDueDate, setMassDueDate] = useState(`${getCurrentPeriodValue()}-10`);
  const [generatingInvoices, setGeneratingInvoices] = useState(false);

  // Manual Billing Form
  const [manualTitle, setManualTitle] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualTargetType, setManualTargetType] = useState<'single' | 'level' | 'all'>('single');
  const [manualStudentId, setManualStudentId] = useState('');
  const [manualLevel, setManualLevel] = useState<SchoolLevel>(school.enabledLevels[0] || 'SD');
  const [manualPeriod, setManualPeriod] = useState('Insidental');
  const [manualDueDate, setManualDueDate] = useState(`${getCurrentPeriodValue()}-25`);
  const [manualNotes, setManualNotes] = useState('');

  // Invoice Ledger Filter
  const [invSearch, setInvSearch] = useState('');
  const [invStatusFilter, setInvStatusFilter] = useState<'all' | 'unpaid' | 'pending_payment' | 'paid'>('all');
  const [invCategoryFilter, setInvCategoryFilter] = useState<'all' | FeeCategory>('all');

  // --- Cashier State ---
  const [cashierSearch, setCashierSearch] = useState('');
  const [cashierStudentId, setCashierStudentId] = useState('');
  const [cashierInvoiceIds, setCashierInvoiceIds] = useState<string[]>([]);
  const [cashierPaymentMode, setCashierPaymentMode] = useState<'full' | 'partial'>('full');
  const [cashierPartialInput, setCashierPartialInput] = useState('');
  const [cashierNotes, setCashierNotes] = useState('');
  const [settlingCash, setSettlingCash] = useState(false);

  // --- Reports State ---
  const [reportPeriod, setReportPeriod] = useState<string>('ALL');
  const [reportLevel, setReportLevel] = useState<'ALL' | SchoolLevel>('ALL');
  const [reportCategory, setReportCategory] = useState<'ALL' | FeeCategory>('ALL');
  const [reportMethod, setReportMethod] = useState<'ALL' | ActivePaymentMethod>('ALL');

  const monthOptions = useMemo(() => getMonthPeriodOptions(), []);

  const enabledTemplateCategories = useMemo(() => {
    const list: { key: TemplateCategory; label: string }[] = [];
    if (school.enabledModules.spp) list.push({ key: 'spp', label: 'SPP Bulanan' });
    if (school.enabledModules.daftarUlang) list.push({ key: 'daftar_ulang', label: 'Daftar Ulang' });
    if (school.enabledModules.jemputan) list.push({ key: 'jemputan', label: 'Jemputan' });
    return list;
  }, [school.enabledModules]);

  useEffect(() => {
    if (
      enabledTemplateCategories.length > 0 &&
      !enabledTemplateCategories.some((c) => c.key === massCategory)
    ) {
      setMassCategory(enabledTemplateCategories[0].key);
    }
  }, [enabledTemplateCategories, massCategory]);

  useEffect(() => {
    if (school.enabledLevels.length > 0 && !school.enabledLevels.includes(manualLevel)) {
      setManualLevel(school.enabledLevels[0]);
    }
  }, [school.enabledLevels, manualLevel]);

  useEffect(() => {
    setCashierStudentId('');
    setCashierInvoiceIds([]);
    setManualStudentId('');
    setErrorMsg('');
  }, [school.id]);

  // --- Overview Metrics ---
  const metrics = useMemo(() => {
    const settled = transactions.filter((t) => t.status === 'settled');
    const totalReceived = settled.reduce((s, t) => s + t.totalAmount, 0);
    const unpaidInvoices = invoices.filter((i) => i.status !== 'paid');
    const totalUnpaid = unpaidInvoices.reduce((s, i) => s + getInvoiceRemainingAmount(i), 0);

    const byCategory = { spp: 0, daftar_ulang: 0, jemputan: 0, manual: 0 };
    invoices.forEach((i) => {
      const paidVal = getInvoicePaidAmount(i);
      if (paidVal > 0) {
        byCategory[i.category] = (byCategory[i.category] || 0) + paidVal;
      }
    });

    const byMethod = { cash: 0, bank_transfer: 0, va: 0, qris: 0 };
    settled.forEach((t) => {
      byMethod[t.method] = (byMethod[t.method] || 0) + t.totalAmount;
    });

    return {
      totalReceived,
      totalUnpaid,
      activeStudents: students.filter((s) => s.status === 'active').length,
      settledCount: settled.length,
      unpaidCount: unpaidInvoices.length,
      byCategory,
      byMethod,
    };
  }, [students, invoices, transactions]);

  // --- Handlers: Settings ---
  const toggleFormLevel = (lvl: SchoolLevel) => {
    setSchoolForm((prev) => {
      const exists = prev.enabledLevels.includes(lvl);
      if (exists && prev.enabledLevels.length <= 1) return prev;
      return {
        ...prev,
        enabledLevels: exists
          ? prev.enabledLevels.filter((l) => l !== lvl)
          : [...prev.enabledLevels, lvl],
      };
    });
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanName = schoolForm.name.trim().slice(0, 120);
    if (cleanName.length < 2) {
      setErrorMsg('Nama sekolah minimal 2 karakter.');
      return;
    }
    setSavingSettings(true);
    try {
      const cleanBankName = schoolForm.bankName.trim().slice(0, 60);
      const cleanBankAccNum = schoolForm.bankAccountNumber.trim().slice(0, 40);
      const cleanBankAccHolder = schoolForm.bankAccountHolder.trim().slice(0, 120);

      await updateDoc(doc(db, 'schools', school.id), {
        name: cleanName,
        npsn: schoolForm.npsn.trim().slice(0, 20),
        address: schoolForm.address.trim().slice(0, 250),
        city: schoolForm.city.trim().slice(0, 80),
        phone: schoolForm.phone.trim().slice(0, 30),
        principalName: schoolForm.principalName.trim().slice(0, 100),
        treasurerName: schoolForm.treasurerName.trim().slice(0, 100),
        bankName: cleanBankName,
        bankAccountNumber: cleanBankAccNum,
        bankAccountHolder: cleanBankAccHolder,
        enabledLevels: schoolForm.enabledLevels,
        enabledModules: schoolForm.enabledModules,
        updatedAt: serverTimestamp(),
      });

      const unpaidToSync = invoices.filter(
        (inv) =>
          inv.status !== 'paid' &&
          ((inv.schoolBankName || '') !== cleanBankName ||
            (inv.schoolBankAccountNumber || '') !== cleanBankAccNum ||
            (inv.schoolBankAccountHolder || '') !== cleanBankAccHolder),
      );
      for (let i = 0; i < unpaidToSync.length; i += 400) {
        const chunk = unpaidToSync.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((inv) => {
          batch.update(doc(db, 'invoices', inv.id), {
            schoolBankName: cleanBankName,
            schoolBankAccountNumber: cleanBankAccNum,
            schoolBankAccountHolder: cleanBankAccHolder,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      setToastMsg(
        'Konfigurasi jenjang, rekening bank sekolah, dan identitas laporan berhasil disimpan & disinkronkan ke tagihan aktif.',
      );
    } catch (err) {
      reportActionError(err, OperationType.UPDATE, `schools/${school.id}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // --- Handlers: Fee Templates ---
  const openCreateTemplate = () => {
    setErrorMsg('');
    const firstCat = enabledTemplateCategories[0]?.key || 'spp';
    const firstLvl = school.enabledLevels[0] || 'SD';
    setEditingTemplate(null);
    setTplCategory(firstCat);
    setTplLevel(firstLvl);
    setTplGrade(LEVEL_GRADES[firstLvl][0]);
    setTplName('');
    setTplAmount('');
    setTplCycle(firstCat === 'daftar_ulang' ? 'annual' : 'monthly');
    setShowTemplateModal(true);
  };

  const openEditTemplate = (tpl: FeeTemplate) => {
    setErrorMsg('');
    setEditingTemplate(tpl);
    setTplCategory(tpl.category);
    setTplLevel(tpl.level);
    setTplGrade(tpl.grade);
    setTplName(tpl.name);
    setTplAmount(String(tpl.amount));
    setTplCycle(tpl.billingCycle);
    setShowTemplateModal(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanTplName = tplName.trim().slice(0, 120);
    const cleanGrade = (tplGrade.trim() || 'Semua Kelas').slice(0, 40);
    const numericAmount = Number(tplAmount.replace(/\D/g, ''));
    if (cleanTplName.length < 2 || !Number.isFinite(numericAmount) || numericAmount < 0) {
      setErrorMsg('Nama tarif minimal 2 karakter dan nominal harus valid.');
      return;
    }

    const tplId = editingTemplate?.id || generateSafeId('tpl');
    const authEmails = school.adminEmails.map((em) => normalizeEmail(em).slice(0, 120)).slice(0, 10);
    try {
      if (editingTemplate) {
        await updateDoc(doc(db, 'feeTemplates', tplId), {
          category: tplCategory,
          name: cleanTplName,
          level: tplLevel,
          grade: cleanGrade,
          amount: numericAmount,
          billingCycle: tplCycle,
          authorizedFinanceEmails: authEmails,
          updatedAt: serverTimestamp(),
        });
        setToastMsg(`Tarif "${cleanTplName}" diperbarui.`);
      } else {
        await setDoc(doc(db, 'feeTemplates', tplId), {
          id: tplId,
          schoolId: school.id,
          authorizedFinanceEmails: authEmails,
          category: tplCategory,
          name: cleanTplName,
          level: tplLevel,
          grade: cleanGrade,
          amount: numericAmount,
          billingCycle: tplCycle,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setToastMsg(`Tarif fleksibel "${cleanTplName}" ditambahkan.`);
      }
      setShowTemplateModal(false);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, `feeTemplates/${tplId}`);
    }
  };

  const handleDeleteTemplate = async (tplId: string) => {
    setErrorMsg('');
    try {
      await deleteDoc(doc(db, 'feeTemplates', tplId));
      setToastMsg('Master tarif dihapus.');
    } catch (err) {
      reportActionError(err, OperationType.DELETE, `feeTemplates/${tplId}`);
    }
  };

  // --- Handlers: Students ---
  const openCreateStudent = () => {
    setErrorMsg('');
    const defaultLvl = school.enabledLevels[0] || 'SD';
    setEditingStudent(null);
    setStuNis('');
    setStuName('');
    setStuLevel(defaultLvl);
    setStuGrade(LEVEL_GRADES[defaultLvl][0]);
    setStuClassName('');
    setStuParentName('');
    setStuParentEmail('');
    setStuParentPhone('');
    setStuUseShuttle(false);
    setStuShuttleZone('');
    setStuCustomSpp('0');
    setStuCustomShuttle('0');
    setStuStatus('active');
    setShowStudentModal(true);
  };

  const openEditStudent = (stu: Student) => {
    setErrorMsg('');
    setEditingStudent(stu);
    setStuNis(stu.nis);
    setStuName(stu.name);
    setStuLevel(stu.level);
    setStuGrade(stu.grade);
    setStuClassName(stu.className || '');
    setStuParentName(stu.parentName);
    setStuParentEmail(stu.parentEmail);
    setStuParentPhone(stu.parentPhone || '');
    setStuUseShuttle(stu.useShuttle);
    setStuShuttleZone(stu.shuttleZone || '');
    setStuCustomSpp(String(stu.customSppAmount || 0));
    setStuCustomShuttle(String(stu.customShuttleAmount || 0));
    setStuStatus(stu.status);
    setShowStudentModal(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanNis = stuNis.trim().slice(0, 30);
    const cleanName = stuName.trim().slice(0, 120);
    const cleanGrade = stuGrade.trim().slice(0, 30);
    const cleanParentName = stuParentName.trim().slice(0, 120);
    const cleanParentEmail = normalizeEmail(stuParentEmail).slice(0, 120);

    if (
      !cleanNis ||
      cleanName.length < 2 ||
      cleanParentName.length < 2 ||
      !cleanParentEmail.includes('@') ||
      cleanParentEmail.length < 3
    ) {
      setErrorMsg('NIS, Nama Siswa (min 2 huruf), Nama Wali (min 2 huruf), dan Email Wali Murid wajib valid.');
      return;
    }
    setSavingStudent(true);
    const stuId = editingStudent?.id || generateSafeId('stu');
    const authEmails = school.adminEmails.map((em) => normalizeEmail(em).slice(0, 120)).slice(0, 10);

    try {
      const payload = {
        nis: cleanNis,
        name: cleanName,
        level: stuLevel,
        grade: cleanGrade,
        className: stuClassName.trim().slice(0, 30),
        parentName: cleanParentName,
        parentEmail: cleanParentEmail,
        parentPhone: stuParentPhone.trim().slice(0, 30),
        useShuttle: stuUseShuttle,
        shuttleZone: stuShuttleZone.trim().slice(0, 60),
        customSppAmount: Number(stuCustomSpp.replace(/\D/g, '')) || 0,
        customShuttleAmount: Number(stuCustomShuttle.replace(/\D/g, '')) || 0,
        status: stuStatus,
        schoolName: school.name.trim().slice(0, 120),
        authorizedFinanceEmails: authEmails,
        updatedAt: serverTimestamp(),
      };

      if (editingStudent) {
        await updateDoc(doc(db, 'students', stuId), payload);
        const relatedActiveInvoices = invoices.filter(
          (inv) =>
            inv.studentId === stuId &&
            inv.status !== 'paid' &&
            (inv.studentName !== cleanName ||
              inv.studentNis !== cleanNis ||
              inv.studentLevel !== stuLevel ||
              inv.studentGrade !== cleanGrade ||
              inv.parentName !== cleanParentName ||
              inv.parentEmail !== cleanParentEmail),
        );
        for (let i = 0; i < relatedActiveInvoices.length; i += 400) {
          const chunk = relatedActiveInvoices.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((inv) => {
            batch.update(doc(db, 'invoices', inv.id), {
              studentName: cleanName,
              studentNis: cleanNis,
              studentLevel: stuLevel,
              studentGrade: cleanGrade,
              parentName: cleanParentName,
              parentEmail: cleanParentEmail,
              updatedAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
        setToastMsg(
          relatedActiveInvoices.length > 0
            ? `Data siswa ${cleanName} diperbarui & disinkronkan ke ${relatedActiveInvoices.length} tagihan aktif.`
            : `Data siswa ${cleanName} diperbarui.`,
        );
      } else {
        await setDoc(doc(db, 'students', stuId), {
          id: stuId,
          schoolId: school.id,
          ...payload,
          createdAt: serverTimestamp(),
        });
        setToastMsg(`Siswa ${cleanName} berhasil ditambahkan.`);
      }
      setShowStudentModal(false);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, `students/${stuId}`);
    } finally {
      setSavingStudent(false);
    }
  };

  const confirmDeleteStudent = async () => {
    if (!deleteStudentTarget) return;
    setErrorMsg('');
    setDeletingStudent(true);
    const stu = deleteStudentTarget;
    const unpaidRelated = invoices.filter(
      (i) => i.studentId === stu.id && i.status !== 'paid',
    );
    try {
      const ops: Array<{ type: 'student' | 'invoice'; id: string }> = [
        { type: 'student', id: stu.id },
        ...unpaidRelated.map((inv) => ({ type: 'invoice' as const, id: inv.id })),
      ];
      for (let i = 0; i < ops.length; i += 400) {
        const chunk = ops.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((item) => {
          batch.delete(doc(db, item.type === 'student' ? 'students' : 'invoices', item.id));
        });
        await batch.commit();
      }
      setToastMsg(
        unpaidRelated.length > 0
          ? `Data siswa ${stu.name} dan ${unpaidRelated.length} tagihan belum lunas berhasil dihapus.`
          : `Data siswa ${stu.name} dihapus.`,
      );
      setDeleteStudentTarget(null);
    } catch (err) {
      reportActionError(err, OperationType.DELETE, `students/${stu.id}`);
    } finally {
      setDeletingStudent(false);
    }
  };

  // --- Handlers: Bulk Excel Import ---
  const downloadStudentExcelTemplate = () => {
    const defaultLvl = school.enabledLevels[0] || 'SD';
    const defaultGrade = LEVEL_GRADES[defaultLvl][0];
    const rows = [
      [
        'NIS',
        'Nama Siswa',
        'Jenjang',
        'Kelas',
        'Rombel',
        'Nama Wali',
        'Email Google Wali',
        'No HP / WA Wali',
        'Ikut Jemputan (YA/TIDAK)',
        'Zona Jemputan',
        'SPP Khusus (0 = Ikut Tarif Kelas)',
      ],
      [
        '20260001',
        'Contoh Siswa Pertama',
        defaultLvl,
        defaultGrade,
        '1A',
        'Bapak Ahmad',
        'orangtua1@gmail.com',
        '081234567890',
        'TIDAK',
        '',
        0,
      ],
      [
        '20260002',
        'Contoh Siswa Kedua',
        defaultLvl,
        defaultGrade,
        '1B',
        'Ibu Sari',
        'orangtua2@gmail.com',
        '081398765432',
        'YA',
        'Zona A',
        350000,
      ],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 24 },
      { wch: 12 },
      { wch: 14 },
      { wch: 10 },
      { wch: 22 },
      { wch: 26 },
      { wch: 18 },
      { wch: 22 },
      { wch: 16 },
      { wch: 26 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Template Siswa');
    XLSX.writeFile(wb, `Template_Import_Siswa_${school.code}.xlsx`);
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setImportFileError('');
    setImportRows([]);
    if (!file) return;

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        setImportFileError('File Excel/CSV kosong.');
        return;
      }
      const rawObjects = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
        defval: '',
      });
      if (rawObjects.length === 0) {
        setImportFileError('Tidak ada baris data siswa di dalam file.');
        return;
      }

      const existingNisSet = new Set(students.map((s) => s.nis.trim().toLowerCase()));
      const seenInFile = new Set<string>();

      const getField = (row: Record<string, unknown>, keys: string[]): string => {
        const entry = Object.entries(row).find(([col]) => {
          const norm = col.toLowerCase().trim();
          return keys.some((k) => norm.includes(k));
        });
        return entry ? String(entry[1] ?? '').trim() : '';
      };

      const parsed: ImportStudentRow[] = rawObjects.slice(0, 1000).map((row, idx) => {
        const nis = getField(row, ['nis']).slice(0, 30);
        const name = getField(row, ['nama siswa', 'nama lengkap', 'student']).slice(0, 120);
        const rawLevel = getField(row, ['jenjang', 'level']).toUpperCase();
        const level: SchoolLevel = (
          ALL_SCHOOL_LEVELS.includes(rawLevel as SchoolLevel)
            ? rawLevel
            : school.enabledLevels[0] || 'SD'
        ) as SchoolLevel;
        const grade = (getField(row, ['kelas', 'tingkat', 'grade']) || LEVEL_GRADES[level][0]).slice(0, 30);
        const className = getField(row, ['rombel', 'class']).slice(0, 30);
        const parentName = getField(row, ['nama wali', 'wali', 'orang tua', 'parent']).slice(0, 120);
        const parentEmail = normalizeEmail(getField(row, ['email'])).slice(0, 120);
        const parentPhone = getField(row, ['hp', 'wa', 'telepon', 'telp', 'phone']).slice(0, 30);
        const rawShuttle = getField(row, ['jemputan', 'shuttle']).toLowerCase();
        const useShuttle =
          rawShuttle === 'ya' || rawShuttle === 'y' || rawShuttle === 'yes' || rawShuttle === 'true' || rawShuttle === '1';
        const shuttleZone = getField(row, ['zona']).slice(0, 60);
        const rawSpp = getField(row, ['spp']).replace(/\D/g, '');
        const customSppAmount = Number(rawSpp) || 0;

        let error = '';
        if (!nis) error = 'NIS kosong';
        else if (existingNisSet.has(nis.toLowerCase())) error = 'NIS sudah terdaftar';
        else if (seenInFile.has(nis.toLowerCase())) error = 'NIS duplikat di file';
        else if (name.length < 2) error = 'Nama siswa min 2 huruf';
        else if (!school.enabledLevels.includes(level)) error = `Jenjang ${level} belum aktif di sekolah`;
        else if (parentName.length < 2) error = 'Nama wali min 2 huruf';
        else if (!parentEmail.includes('@') || parentEmail.length < 3) error = 'Email wali tidak valid';

        if (nis) seenInFile.add(nis.toLowerCase());

        return {
          rowNum: idx + 2,
          nis,
          name,
          level,
          grade,
          className,
          parentName,
          parentEmail,
          parentPhone,
          useShuttle,
          shuttleZone,
          customSppAmount,
          error: error || undefined,
        };
      });

      setImportRows(parsed);
    } catch {
      setImportFileError('File tidak dapat dibaca. Pastikan format .xlsx, .xls, atau .csv valid.');
    }
  };

  const handleCommitImportStudents = async () => {
    const validRows = importRows.filter((r) => !r.error);
    if (validRows.length === 0) return;
    setImportingStudents(true);
    setErrorMsg('');
    const authEmails = school.adminEmails.map((em) => normalizeEmail(em).slice(0, 120)).slice(0, 10);
    try {
      for (let i = 0; i < validRows.length; i += 400) {
        const chunk = validRows.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((row) => {
          const stuId = generateSafeId('stu');
          batch.set(doc(db, 'students', stuId), {
            id: stuId,
            schoolId: school.id,
            schoolName: school.name.trim().slice(0, 120),
            authorizedFinanceEmails: authEmails,
            nis: row.nis,
            name: row.name,
            level: row.level,
            grade: row.grade,
            className: row.className,
            parentName: row.parentName,
            parentEmail: row.parentEmail,
            parentPhone: row.parentPhone,
            useShuttle: row.useShuttle,
            shuttleZone: row.shuttleZone,
            customSppAmount: row.customSppAmount,
            customShuttleAmount: 0,
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      setToastMsg(`${validRows.length} siswa baru berhasil diimpor ke database sekolah.`);
      setShowImportModal(false);
      setImportRows([]);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, 'students/import');
    } finally {
      setImportingStudents(false);
    }
  };

  // --- Handlers: Mass Grade Promotion & Graduation ---
  const promoteCandidates = useMemo(() => {
    return students
      .filter((s) => s.status === 'active')
      .filter((s) => promoteLevel === 'ALL' || s.level === promoteLevel)
      .filter((s) => promoteGrade === 'ALL' || s.grade === promoteGrade)
      .map((s) => ({
        student: s,
        ...getNextGradePromotion(s.level, s.grade),
      }));
  }, [students, promoteLevel, promoteGrade]);

  const handleExecutePromote = async () => {
    if (promoteCandidates.length === 0) return;
    setPromotingStudents(true);
    setErrorMsg('');
    try {
      const updates: Array<{ col: 'students' | 'invoices'; id: string; data: Record<string, unknown> }> = [];
      promoteCandidates.forEach(({ student, nextGrade, nextStatus }) => {
        updates.push({
          col: 'students',
          id: student.id,
          data: {
            grade: nextGrade,
            status: nextStatus,
            updatedAt: serverTimestamp(),
          },
        });
        invoices
          .filter((inv) => inv.studentId === student.id && inv.status !== 'paid' && inv.studentGrade !== nextGrade)
          .forEach((inv) => {
            updates.push({
              col: 'invoices',
              id: inv.id,
              data: {
                studentGrade: nextGrade,
                updatedAt: serverTimestamp(),
              },
            });
          });
      });

      for (let i = 0; i < updates.length; i += 400) {
        const chunk = updates.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((item) => {
          batch.update(doc(db, item.col, item.id), item.data);
        });
        await batch.commit();
      }

      const graduatedCnt = promoteCandidates.filter((c) => c.nextStatus === 'graduated').length;
      const promotedCnt = promoteCandidates.length - graduatedCnt;
      setToastMsg(
        `Proses selesai: ${promotedCnt} siswa naik kelas dan ${graduatedCnt} siswa tingkat akhir ditandai Lulus.`,
      );
      setShowPromoteModal(false);
    } catch (err) {
      reportActionError(err, OperationType.UPDATE, 'students/promote');
    } finally {
      setPromotingStudents(false);
    }
  };

  // --- Handlers: Mass & Manual Billing ---
  const resolveStudentAmount = (stu: Student, category: TemplateCategory, fallback: number): number => {
    if (category === 'spp' && stu.customSppAmount > 0) return stu.customSppAmount;
    if (category === 'jemputan' && stu.customShuttleAmount > 0) return stu.customShuttleAmount;

    const exactGradeTpl = feeTemplates.find(
      (t) =>
        t.isActive &&
        t.category === category &&
        (t.level === stu.level || t.level === 'ALL') &&
        (t.grade.toLowerCase() === stu.grade.toLowerCase() ||
          (category === 'jemputan' && stu.shuttleZone && t.grade.toLowerCase() === stu.shuttleZone.toLowerCase())),
    );
    if (exactGradeTpl) return exactGradeTpl.amount;

    const levelTpl = feeTemplates.find(
      (t) => t.isActive && t.category === category && (t.level === stu.level || t.level === 'ALL'),
    );
    if (levelTpl) return levelTpl.amount;

    return fallback;
  };

  const handleGenerateMassInvoices = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const fallbackNum = Number(massFallbackAmount.replace(/\D/g, '')) || 0;
    const cleanPeriod = (massPeriod.trim() || getCurrentPeriodValue()).slice(0, 40);
    const cleanDueDate = (massDueDate.trim() || `${getCurrentPeriodValue()}-10`).slice(0, 20);

    const targetStudents = students.filter((s) => {
      if (s.status !== 'active') return false;
      if (massTargetLevel !== 'ALL' && s.level !== massTargetLevel) return false;
      if (massTargetGrade !== 'ALL' && s.grade !== massTargetGrade) return false;
      if (massCategory === 'jemputan' && !s.useShuttle) return false;
      return true;
    });

    if (targetStudents.length === 0) {
      setErrorMsg('Tidak ada siswa aktif yang memenuhi kriteria penerbitan tagihan.');
      return;
    }

    const docsToWrite: Array<{ id: string; data: Record<string, unknown> }> = [];
    const authEmails = school.adminEmails.map((em) => normalizeEmail(em).slice(0, 120)).slice(0, 10);

    targetStudents.forEach((stu) => {
      const duplicate = invoices.some(
        (inv) =>
          inv.studentId === stu.id &&
          inv.category === massCategory &&
          inv.period === cleanPeriod,
      );
      if (duplicate) return;

      const amt = resolveStudentAmount(stu, massCategory, fallbackNum);
      if (amt <= 0) return;

      const invId = generateSafeId('inv');
      const titleBase = CATEGORY_LABELS[massCategory];
      const rawTitle =
        massCategory === 'jemputan' && stu.shuttleZone
          ? `Jemputan ${stu.shuttleZone} (${formatPeriodLabel(cleanPeriod)})`
          : `${titleBase} (${formatPeriodLabel(cleanPeriod)})`;

      docsToWrite.push({
        id: invId,
        data: {
          id: invId,
          schoolId: school.id,
          schoolName: school.name.trim().slice(0, 120),
          authorizedFinanceEmails: authEmails,
          studentId: stu.id,
          studentNis: stu.nis.slice(0, 30),
          studentName: stu.name.slice(0, 120),
          studentLevel: stu.level,
          studentGrade: stu.grade.slice(0, 30),
          parentEmail: normalizeEmail(stu.parentEmail).slice(0, 120),
          parentName: stu.parentName.slice(0, 120),
          category: massCategory,
          title: rawTitle.slice(0, 150),
          period: cleanPeriod,
          amount: amt,
          dueDate: cleanDueDate,
          notes: '',
          status: 'unpaid',
          paymentMethod: 'none',
          schoolBankName: (school.bankName || '').trim().slice(0, 60),
          schoolBankAccountNumber: (school.bankAccountNumber || '').trim().slice(0, 40),
          schoolBankAccountHolder: (school.bankAccountHolder || '').trim().slice(0, 120),
          createdBy: userUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      });
    });

    if (docsToWrite.length === 0) {
      setErrorMsg('Semua siswa target sudah memiliki tagihan pada periode tersebut atau nominalnya Rp 0.');
      return;
    }

    setGeneratingInvoices(true);
    try {
      for (let i = 0; i < docsToWrite.length; i += 400) {
        const chunk = docsToWrite.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((item) => batch.set(doc(db, 'invoices', item.id), item.data));
        await batch.commit();
      }
      setToastMsg(`${docsToWrite.length} tagihan ${CATEGORY_LABELS[massCategory]} berhasil diterbitkan.`);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, 'invoices/mass');
    } finally {
      setGeneratingInvoices(false);
    }
  };

  const handleCreateManualInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanTitle = manualTitle.trim().slice(0, 150);
    const cleanPeriod = (manualPeriod.trim() || 'Insidental').slice(0, 40);
    const cleanDueDate = (manualDueDate.trim() || `${getCurrentPeriodValue()}-25`).slice(0, 20);
    const numAmount = Number(manualAmount.replace(/\D/g, ''));
    if (cleanTitle.length < 2 || !Number.isFinite(numAmount) || numAmount <= 0) {
      setErrorMsg('Judul tagihan manual (min 2 karakter) dan nominal (> Rp 0) wajib diisi.');
      return;
    }

    const targets = students.filter((s) => {
      if (s.status !== 'active') return false;
      if (manualTargetType === 'single') return s.id === manualStudentId;
      if (manualTargetType === 'level') return s.level === manualLevel;
      return true;
    });

    if (targets.length === 0) {
      setErrorMsg('Pilih siswa atau jenjang target yang valid.');
      return;
    }

    const authEmails = school.adminEmails.map((em) => normalizeEmail(em).slice(0, 120)).slice(0, 10);
    setGeneratingInvoices(true);

    try {
      for (let i = 0; i < targets.length; i += 400) {
        const chunk = targets.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((stu) => {
          const invId = generateSafeId('inv');
          batch.set(doc(db, 'invoices', invId), {
            id: invId,
            schoolId: school.id,
            schoolName: school.name.trim().slice(0, 120),
            authorizedFinanceEmails: authEmails,
            studentId: stu.id,
            studentNis: stu.nis.slice(0, 30),
            studentName: stu.name.slice(0, 120),
            studentLevel: stu.level,
            studentGrade: stu.grade.slice(0, 30),
            parentEmail: normalizeEmail(stu.parentEmail).slice(0, 120),
            parentName: stu.parentName.slice(0, 120),
            category: 'manual',
            title: cleanTitle,
            period: cleanPeriod,
            amount: numAmount,
            dueDate: cleanDueDate,
            notes: manualNotes.trim().slice(0, 300),
            status: 'unpaid',
            paymentMethod: 'none',
            schoolBankName: (school.bankName || '').trim().slice(0, 60),
            schoolBankAccountNumber: (school.bankAccountNumber || '').trim().slice(0, 40),
            schoolBankAccountHolder: (school.bankAccountHolder || '').trim().slice(0, 120),
            createdBy: userUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      setToastMsg(`Tagihan manual "${cleanTitle}" diterbitkan untuk ${targets.length} siswa.`);
      setManualTitle('');
      setManualAmount('');
      setManualNotes('');
    } catch (err) {
      reportActionError(err, OperationType.WRITE, 'invoices/manual');
    } finally {
      setGeneratingInvoices(false);
    }
  };

  const openEditInvoice = (inv: Invoice) => {
    if (inv.status !== 'unpaid') return;
    setErrorMsg('');
    setEditingInvoice(inv);
    setEditInvTitle(inv.title);
    setEditInvPeriod(inv.period);
    setEditInvAmount(String(inv.amount));
    setEditInvDueDate(inv.dueDate);
    setEditInvNotes(inv.notes || '');
  };

  const handleSaveInvoiceEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;
    setErrorMsg('');
    const cleanTitle = editInvTitle.trim().slice(0, 150);
    const cleanPeriod = (editInvPeriod.trim() || editingInvoice.period).slice(0, 40);
    const cleanDueDate = (editInvDueDate.trim() || editingInvoice.dueDate).slice(0, 20);
    const numAmount = Number(editInvAmount.replace(/\D/g, ''));
    const alreadyPaid = getInvoicePaidAmount(editingInvoice);

    if (cleanTitle.length < 2) {
      setErrorMsg('Judul tagihan minimal 2 karakter.');
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount < 1000) {
      setErrorMsg('Nominal tagihan minimal Rp 1.000.');
      return;
    }
    if (numAmount <= alreadyPaid) {
      setErrorMsg(
        `Nominal tagihan harus lebih besar dari jumlah yang sudah dicicil (${formatRupiah(alreadyPaid)}).`,
      );
      return;
    }

    setSavingInvoiceEdit(true);
    try {
      await updateDoc(doc(db, 'invoices', editingInvoice.id), {
        title: cleanTitle,
        period: cleanPeriod,
        amount: Math.round(numAmount),
        dueDate: cleanDueDate,
        notes: editInvNotes.trim().slice(0, 300),
        updatedAt: serverTimestamp(),
      });
      setToastMsg(`Tagihan "${cleanTitle}" untuk ${editingInvoice.studentName} berhasil diperbarui.`);
      setEditingInvoice(null);
    } catch (err) {
      reportActionError(err, OperationType.UPDATE, `invoices/${editingInvoice.id}`);
    } finally {
      setSavingInvoiceEdit(false);
    }
  };

  const handleDeleteUnpaidInvoice = async (inv: Invoice) => {
    if (inv.status === 'paid') return;
    setErrorMsg('');
    try {
      await deleteDoc(doc(db, 'invoices', inv.id));
      setToastMsg(`Tagihan "${inv.title}" untuk ${inv.studentName} dihapus.`);
    } catch (err) {
      reportActionError(err, OperationType.DELETE, `invoices/${inv.id}`);
    }
  };

  // --- Handlers: Cashier ---
  const cashierStudents = useMemo(() => {
    const q = cashierSearch.trim().toLowerCase();
    return students.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.nis.toLowerCase().includes(q) ||
        s.grade.toLowerCase().includes(q),
    );
  }, [students, cashierSearch]);

  const selectedCashierStudent = useMemo(
    () => students.find((s) => s.id === cashierStudentId) || null,
    [students, cashierStudentId],
  );

  const cashierStudentInvoices = useMemo(() => {
    if (!selectedCashierStudent) return [];
    return invoices.filter(
      (i) => i.studentId === selectedCashierStudent.id && i.status !== 'paid',
    );
  }, [invoices, selectedCashierStudent]);

  const selectedCashierInvoices = useMemo(
    () => cashierStudentInvoices.filter((i) => cashierInvoiceIds.includes(i.id)),
    [cashierStudentInvoices, cashierInvoiceIds],
  );

  const cashierFullRemaining = selectedCashierInvoices.reduce(
    (s, i) => s + getInvoiceRemainingAmount(i),
    0,
  );
  const canCashierPartial =
    selectedCashierInvoices.length === 1 &&
    getInvoiceRemainingAmount(selectedCashierInvoices[0]) >= 2000;
  const parsedCashierPartial = Number(cashierPartialInput.replace(/\D/g, '')) || 0;
  const cashierTotal =
    canCashierPartial && cashierPaymentMode === 'partial'
      ? parsedCashierPartial
      : cashierFullRemaining;

  const handleSettleCash = async () => {
    if (selectedCashierInvoices.length === 0) return;
    setErrorMsg('');
    let customPartialAmount: number | undefined;
    if (canCashierPartial && cashierPaymentMode === 'partial') {
      const rem = getInvoiceRemainingAmount(selectedCashierInvoices[0]);
      if (parsedCashierPartial < 1000) {
        setErrorMsg('Nominal cicilan tunai minimal Rp 1.000.');
        return;
      }
      if (parsedCashierPartial > rem) {
        setErrorMsg(`Nominal cicilan tidak boleh melebihi sisa tagihan (${formatRupiah(rem)}).`);
        return;
      }
      if (parsedCashierPartial < rem) {
        customPartialAmount = parsedCashierPartial;
      }
    }

    setSettlingCash(true);
    try {
      const tx = await settleCashPayment({
        school,
        invoices: selectedCashierInvoices,
        cashierUid: userUid,
        cashierEmail: userEmail,
        notes: cashierNotes,
        customPartialAmount,
      });
      setCashierInvoiceIds([]);
      setCashierPaymentMode('full');
      setCashierPartialInput('');
      setCashierNotes('');
      setReceiptTx(tx);
      setToastMsg(
        customPartialAmount
          ? `Cicilan tunai ${tx.receiptNumber} sebesar ${formatRupiah(tx.totalAmount)} tercatat.`
          : `Pembayaran tunai ${tx.receiptNumber} sebesar ${formatRupiah(tx.totalAmount)} tercatat lunas.`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memproses kasir tunai.');
    } finally {
      setSettlingCash(false);
    }
  };

  const pendingDigitalTxs = useMemo(
    () => transactions.filter((t) => t.status === 'pending'),
    [transactions],
  );

  // --- Filtered Lists ---
  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return students
      .filter((s) => studentStatusFilter === 'all' || s.status === studentStatusFilter)
      .filter((s) => studentLevelFilter === 'all' || s.level === studentLevelFilter)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.nis.toLowerCase().includes(q) ||
          s.parentName.toLowerCase().includes(q) ||
          s.parentEmail.toLowerCase().includes(q),
      );
  }, [students, studentSearch, studentLevelFilter, studentStatusFilter]);

  const filteredInvoices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return invoices
      .filter((i) => invStatusFilter === 'all' || i.status === invStatusFilter)
      .filter((i) => invCategoryFilter === 'all' || i.category === invCategoryFilter)
      .filter(
        (i) =>
          !q ||
          i.studentName.toLowerCase().includes(q) ||
          i.studentNis.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q),
      )
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [invoices, invSearch, invStatusFilter, invCategoryFilter]);

  // --- Reports Computation ---
  const reportData = useMemo(() => {
    const settled = transactions
      .filter((t) => t.status === 'settled')
      .filter((t) => reportLevel === 'ALL' || t.studentLevel === reportLevel)
      .filter((t) => reportMethod === 'ALL' || t.method === reportMethod)
      .filter((t) => {
        if (reportCategory === 'ALL') return true;
        return t.categories.includes(reportCategory);
      })
      .filter((t) => {
        if (reportPeriod === 'ALL') return true;
        return (t.settledAt || '').startsWith(reportPeriod);
      })
      .sort((a, b) => (b.settledAt || '').localeCompare(a.settledAt || ''));

    const paidInvs = invoices
      .filter((i) => i.status === 'paid')
      .filter((i) => reportLevel === 'ALL' || i.studentLevel === reportLevel)
      .filter((i) => reportCategory === 'ALL' || i.category === reportCategory)
      .filter((i) => reportMethod === 'ALL' || i.paymentMethod === reportMethod)
      .filter((i) => {
        if (reportPeriod === 'ALL') return true;
        return i.period === reportPeriod || (i.paidAt || '').startsWith(reportPeriod);
      });

    const unpaidInvs = invoices
      .filter((i) => i.status !== 'paid')
      .filter((i) => reportLevel === 'ALL' || i.studentLevel === reportLevel)
      .filter((i) => reportCategory === 'ALL' || i.category === reportCategory)
      .filter((i) => {
        if (reportPeriod === 'ALL') return true;
        return i.period === reportPeriod;
      });

    const periodLabel =
      reportPeriod === 'ALL' ? 'Semua Periode' : formatPeriodLabel(reportPeriod);
    const filterSummary = [
      `Jenjang: ${reportLevel === 'ALL' ? 'Semua' : reportLevel}`,
      `Kategori: ${reportCategory === 'ALL' ? 'Semua' : CATEGORY_LABELS[reportCategory]}`,
      `Metode: ${reportMethod === 'ALL' ? 'Semua' : ACTIVE_METHOD_LABELS[reportMethod]}`,
    ].join(' · ');

    return { settled, paidInvs, unpaidInvs, periodLabel, filterSummary };
  }, [transactions, invoices, reportPeriod, reportLevel, reportCategory, reportMethod]);

  const navItems: ShellNavItem[] = [
    { key: 'overview', label: 'Ringkasan', shortLabel: 'Ringkasan', icon: Layers },
    { key: 'settings', label: 'Jenjang & Tarif', shortLabel: 'Tarif', icon: Settings },
    { key: 'students', label: 'Data Siswa', shortLabel: 'Siswa', icon: Users, count: metrics.activeStudents },
    { key: 'billing', label: 'Tagihan & Manual', shortLabel: 'Tagihan', icon: FileText, count: metrics.unpaidCount },
    {
      key: 'cashier',
      label: 'Kasir & Verifikasi',
      shortLabel: 'Kasir',
      icon: Banknote,
      count: pendingDigitalTxs.length,
    },
    { key: 'reports', label: 'Laporan Excel / PDF', shortLabel: 'Laporan', icon: FileSpreadsheet },
  ];

  const collectionTotal = metrics.totalReceived + metrics.totalUnpaid;
  const collectionPercent =
    collectionTotal > 0 ? Math.round((metrics.totalReceived / collectionTotal) * 100) : 0;

  const MODULE_DOTS = ['bg-blue-500', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500'];
  const secondaryItems: ShellSecondaryItem[] =
    allSchools && allSchools.length > 1 && onSwitchSchool
      ? allSchools.map((s, idx) => ({
          id: s.id,
          label: s.name,
          meta: s.code,
          active: s.id === school.id,
          dotColorClass: MODULE_DOTS[idx % MODULE_DOTS.length],
          onClick: () => onSwitchSchool(s.id),
        }))
      : [
          school.enabledModules.spp && {
            id: 'mod-spp',
            label: 'SPP Bulanan',
            dotColorClass: 'bg-[#2563EB]',
            onClick: () => setActiveTab('billing'),
          },
          school.enabledModules.daftarUlang && {
            id: 'mod-du',
            label: 'Daftar Ulang',
            dotColorClass: 'bg-sky-500',
            onClick: () => setActiveTab('billing'),
          },
          school.enabledModules.jemputan && {
            id: 'mod-jemp',
            label: 'Jemputan',
            dotColorClass: 'bg-amber-500',
            onClick: () => setActiveTab('billing'),
          },
          {
            id: 'mod-manual',
            label: 'Tagihan Manual',
            dotColorClass: 'bg-emerald-500',
            onClick: () => setActiveTab('billing'),
          },
        ].filter(Boolean) as ShellSecondaryItem[];

  const handleMobileCenterAction = () => {
    if (activeTab === 'students') {
      openCreateStudent();
    } else if (activeTab === 'settings') {
      openCreateTemplate();
    } else if (activeTab === 'billing') {
      setActiveTab('cashier');
    } else {
      setActiveTab('billing');
    }
  };

  const sidebarSchoolCard = (
    <div className="p-3 rounded-xl bg-[#F8FAFD] border border-slate-200/75 space-y-1.5">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-[#EEF4FF] border border-blue-100 text-[#2563EB] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
          {school.code.slice(0, 3)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#2563EB]">
            Keuangan Sekolah
          </p>
          {allSchools && allSchools.length > 1 && onSwitchSchool ? (
            <select
              value={school.id}
              onChange={(e) => onSwitchSchool(e.target.value)}
              aria-label="Pilih sekolah"
              className="w-full mt-0.5 text-xs font-bold bg-transparent text-slate-900 focus:outline-none truncate"
            >
              {allSchools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="font-display text-xs font-bold text-slate-900 truncate leading-snug">
              {school.name}
            </p>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 truncate">
        Jenjang: {school.enabledLevels.join(' · ')}
      </p>
    </div>
  );

  return (
    <AppShell
      shell={shell}
      navItems={navItems}
      activeNavKey={activeTab}
      onSelectNav={(key) => setActiveTab(key as FinanceTab)}
      mobilePrimaryNavKeys={['overview', 'students', 'cashier']}
      onMobilePrimaryAction={handleMobileCenterAction}
      mobilePrimaryActionLabel={
        activeTab === 'students'
          ? 'Tambah Siswa'
          : activeTab === 'settings'
            ? 'Tambah Tarif'
            : 'Tagihan & Manual'
      }
      sidebarHeaderExtra={sidebarSchoolCard}
      secondarySectionTitle={
        allSchools && allSchools.length > 1 ? 'Sekolah Mitra' : 'Modul Layanan Aktif'
      }
      secondaryItems={secondaryItems}
      progressWidget={{
        title: 'Kolektibilitas',
        rightText: `${collectionPercent}%`,
        percent: collectionPercent,
      }}
      topSearchValue={
        activeTab === 'students'
          ? studentSearch
          : activeTab === 'billing'
            ? invSearch
            : activeTab === 'cashier'
              ? cashierSearch
              : undefined
      }
      topSearchPlaceholder={
        activeTab === 'students'
          ? 'Cari nama siswa, NIS, wali...'
          : activeTab === 'billing'
            ? 'Cari tagihan, siswa, NIS...'
            : activeTab === 'cashier'
              ? 'Cari siswa di kasir...'
              : undefined
      }
      onTopSearchChange={
        activeTab === 'students'
          ? setStudentSearch
          : activeTab === 'billing'
            ? setInvSearch
            : activeTab === 'cashier'
              ? setCashierSearch
              : undefined
      }
    >
      <div className="space-y-6 min-w-0">
        {toastMsg && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-medium text-emerald-800 flex items-center justify-between gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span>{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg('')}
              className="font-semibold text-emerald-700 hover:text-emerald-900 shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {errorMsg &&
          !showTemplateModal &&
          !showStudentModal &&
          !deleteStudentTarget &&
          !editingInvoice &&
          !showImportModal &&
          !showPromoteModal && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-medium text-red-700 flex items-center justify-between gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <span className="break-all">{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg('')}
                className="font-semibold text-red-800 shrink-0"
              >
                Tutup
              </button>
            </div>
          )}

        {/* TAB 1: OVERVIEW (2-Column Reference Layout) */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-panel-enter">
            {/* Airy Page Title & Top Actions */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">
                  Ringkasan Keuangan Sekolah
                </p>
                <h1 className="font-display text-2xl sm:text-[28px] font-extrabold text-slate-900 tracking-tight leading-tight">
                  {school.name}
                </h1>
                <p className="text-xs text-slate-500">
                  Kode <strong className="text-slate-800 font-semibold">{school.code}</strong> · Jenjang{' '}
                  {school.enabledLevels.join(', ')} · {school.city || 'Indonesia'}
                  {school.npsn ? ` · NPSN ${school.npsn}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('reports')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200/90 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh Laporan A4
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('cashier')}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0 shadow-[0_4px_12px_rgba(37,99,235,0.28)]"
                >
                  <Banknote className="w-3.5 h-3.5" />
                  Buka Kasir Tunai
                </button>
              </div>
            </div>

            <div className="grid xl:grid-cols-12 gap-6 items-start">
              {/* Left Primary Column */}
              <div className="xl:col-span-8 space-y-6 min-w-0">
                {/* Deep Royal Navy-Blue Hero Card (Matches Reference Focus Card) */}
                <div className="bg-gradient-to-br from-[#132652] via-[#1B3C7C] to-[#244FA3] text-white rounded-[20px] p-6 sm:p-7 shadow-[0_12px_28px_rgba(20,39,84,0.18)] space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <p className="text-xs font-medium text-blue-200">
                        Total Penerimaan Lunas
                      </p>
                      <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
                        {formatRupiah(metrics.totalReceived)}
                      </p>
                      <p className="text-xs text-blue-100/85">
                        {metrics.settledCount} transaksi selesai · {metrics.unpaidCount} tagihan aktif · {metrics.activeStudents} siswa aktif
                      </p>
                    </div>
                    <span className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[11px] font-semibold text-white whitespace-nowrap shrink-0">
                      {collectionPercent}% Tertagih
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('cashier')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-900 bg-white rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0 shadow-xs"
                    >
                      <Banknote className="w-3.5 h-3.5 text-[#2563EB]" />
                      Buka Kasir Tunai
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('reports')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-white/12 border border-white/20 rounded-xl hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Unduh Laporan A4
                    </button>
                  </div>
                </div>

                {/* 4 Crisp White KPI Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <p className="text-xs font-medium text-slate-500">Total Penerimaan Lunas</p>
                    <p className="text-lg sm:text-xl font-mono font-bold text-[#2563EB] tabular-nums mt-1.5 break-all">
                      {formatRupiah(metrics.totalReceived)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">{metrics.settledCount} transaksi selesai</p>
                  </div>
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <p className="text-xs font-medium text-slate-500">Tagihan Belum Lunas</p>
                    <p className="text-lg sm:text-xl font-mono font-bold text-slate-900 tabular-nums mt-1.5 break-all">
                      {formatRupiah(metrics.totalUnpaid)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">{metrics.unpaidCount} tagihan aktif</p>
                  </div>
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <p className="text-xs font-medium text-slate-500">Siswa Aktif</p>
                    <p className="text-xl sm:text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1.5">
                      {metrics.activeStudents}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      Jenjang {school.enabledLevels.join(', ')}
                    </p>
                  </div>
                  <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                    <p className="text-xs font-medium text-slate-500">Menunggu Verifikasi</p>
                    <p className="text-xl sm:text-2xl font-mono font-bold text-amber-600 tabular-nums mt-1.5">
                      {pendingDigitalTxs.length}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">Transfer / VA / QRIS</p>
                  </div>
                </div>

                {/* Statistik Ringkasan Real-Time: Pendapatan Bulan Ini, Tertunggak & Grafik Tren */}
                <SchoolFinanceStatsOverview
                  invoices={invoices}
                  transactions={transactions}
                  onNavigateTab={(tab) => setActiveTab(tab)}
                  onViewUnpaidInvoices={() => {
                    setInvStatusFilter('unpaid');
                    setActiveTab('billing');
                  }}
                />

                {/* Progres Kolektibilitas Tagihan */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-sm font-bold text-slate-900">
                        Progres Kolektibilitas Tagihan
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Perbandingan dana yang telah diterima lunas terhadap total seluruh tagihan diterbitkan
                      </p>
                    </div>
                    <span className="font-mono text-sm font-bold text-[#2563EB] tabular-nums">
                      {collectionPercent}% Tertagih
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-[#2563EB] transition-all duration-500"
                      style={{ width: `${collectionPercent}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 font-mono tabular-nums pt-0.5">
                    <span>Lunas: {formatRupiah(metrics.totalReceived)}</span>
                    <span>Belum Lunas: {formatRupiah(metrics.totalUnpaid)}</span>
                  </div>
                </div>
              </div>

              {/* Right Rail Analytics (Matches Reference Ring Card & Progress Bars) */}
              <div className="xl:col-span-4 space-y-5">
                {/* Circular Collectibility Ring Card */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
                  <div className="flex items-center gap-4">
                    <CircularProgressRing percent={collectionPercent} size={64} strokeWidth={6} />
                    <div className="min-w-0">
                      <p className="font-display text-sm font-bold text-slate-900">
                        Progres Kolektibilitas Tagihan
                      </p>
                      <p className="font-mono text-sm font-bold text-[#2563EB] tabular-nums mt-0.5 truncate">
                        {formatRupiah(metrics.totalReceived)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {collectionPercent}% Tertagih
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500">Tagihan Belum Lunas</span>
                    <span className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatRupiah(metrics.totalUnpaid)}
                    </span>
                  </div>
                </div>

                {/* Penerimaan per Kategori */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-slate-900">
                      Penerimaan per Kategori
                    </h2>
                    <span className="text-[11px] font-medium text-slate-400">Proporsi Lunas</span>
                  </div>
                  <div className="space-y-3.5 text-sm">
                    {(
                      [
                        ['spp', 'SPP Bulanan', 'bg-[#2563EB]', 'bg-blue-500'],
                        ['daftar_ulang', 'Daftar Ulang', 'bg-sky-500', 'bg-sky-500'],
                        ['jemputan', 'Jemputan', 'bg-amber-500', 'bg-amber-500'],
                        ['manual', 'Tagihan Manual', 'bg-emerald-500', 'bg-emerald-500'],
                      ] as const
                    ).map(([cat, label, barColor, dotColor]) => {
                      const amount = metrics.byCategory[cat];
                      const totalCat =
                        metrics.byCategory.spp +
                        metrics.byCategory.daftar_ulang +
                        metrics.byCategory.jemputan +
                        metrics.byCategory.manual;
                      const pct = totalCat > 0 ? Math.round((amount / totalCat) * 100) : 0;
                      return (
                        <div key={cat} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 text-slate-600 text-xs font-medium">
                              <span className={`w-2 h-2 rounded-[3px] ${dotColor} shrink-0`} />
                              {label}{' '}
                              <span className="text-slate-400 font-mono tabular-nums">({pct}%)</span>
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                              {formatRupiah(amount)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Penerimaan per Metode */}
                <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-sm font-bold text-slate-900">
                      Penerimaan per Metode
                    </h2>
                    <span className="text-[11px] font-medium text-slate-400">Kanal Bayar</span>
                  </div>
                  <div className="space-y-3.5 text-sm">
                    {(
                      [
                        ['cash', 'Kasir Tunai', 'bg-[#1B3C7C]', 'bg-[#1B3C7C]'],
                        ['bank_transfer', 'Transfer Bank Rekening Sekolah', 'bg-[#2563EB]', 'bg-[#2563EB]'],
                        ['va', 'Virtual Account (VA)', 'bg-sky-500', 'bg-sky-500'],
                        ['qris', 'QRIS', 'bg-emerald-500', 'bg-emerald-500'],
                      ] as const
                    ).map(([m, label, barColor, dotColor]) => {
                      const amount = metrics.byMethod[m];
                      const pct =
                        metrics.totalReceived > 0
                          ? Math.round((amount / metrics.totalReceived) * 100)
                          : 0;
                      return (
                        <div key={m} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 text-slate-600 text-xs font-medium min-w-0">
                              <span className={`w-2 h-2 rounded-[3px] ${dotColor} shrink-0`} />
                              <span className="truncate">{label}</span>{' '}
                              <span className="text-slate-400 font-mono tabular-nums shrink-0">
                                ({pct}%)
                              </span>
                            </span>
                            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums shrink-0">
                              {formatRupiah(amount)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all duration-500`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: JENJANG, MODUL & MASTER TARIF FLEKSIBEL */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-panel-enter">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <h2 className="font-display text-base font-bold text-slate-900 mb-1">
                Konfigurasi Jenjang, Layanan &amp; Identitas Kop Laporan
              </h2>
              <p className="text-xs text-slate-500 mb-5">
                Atur jenjang yang tersedia di sekolah Anda (misal SD saja, SD &amp; SMP, atau lengkap TK–SMA) serta layanan tagihan aktif.
              </p>

              <form onSubmit={handleSaveSettings} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Jenjang Sekolah Aktif
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_SCHOOL_LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => toggleFormLevel(lvl)}
                        className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                          schoolForm.enabledLevels.includes(lvl)
                            ? 'bg-[#2563EB] text-white border-[#2563EB]'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Modul Pembayaran Sekolah (Tagihan Manual selalu aktif)
                  </label>
                  <div className="grid sm:grid-cols-3 gap-3">
                    {[
                      { key: 'spp' as const, label: 'SPP Bulanan' },
                      { key: 'daftarUlang' as const, label: 'Daftar Ulang' },
                      { key: 'jemputan' as const, label: 'Jemputan' },
                    ].map((m) => (
                      <label
                        key={m.key}
                        className="flex items-center gap-2.5 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={schoolForm.enabledModules[m.key]}
                          onChange={(e) =>
                            setSchoolForm((prev) => ({
                              ...prev,
                              enabledModules: {
                                ...prev.enabledModules,
                                [m.key]: e.target.checked,
                              },
                            }))
                          }
                          className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Sekolah</label>
                    <input
                      type="text"
                      required
                      value={schoolForm.name}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">NPSN</label>
                    <input
                      type="text"
                      value={schoolForm.npsn}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, npsn: e.target.value }))}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Alamat Sekolah</label>
                    <input
                      type="text"
                      value={schoolForm.address}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, address: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Kota</label>
                    <input
                      type="text"
                      value={schoolForm.city}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, city: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Telepon</label>
                    <input
                      type="text"
                      value={schoolForm.phone}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, phone: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Kepala Sekolah</label>
                    <input
                      type="text"
                      value={schoolForm.principalName}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, principalName: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Bendahara</label>
                    <input
                      type="text"
                      value={schoolForm.treasurerName}
                      onChange={(e) => setSchoolForm((p) => ({ ...p, treasurerName: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>

                {/* Rekening Bank Sekolah */}
                <div className="p-4 bg-slate-50/90 border border-slate-200/80 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#2563EB] shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Rekening Bank Sekolah (Transfer Langsung &amp; Pencairan Midtrans)
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Ditampilkan langsung ke wali murid saat memilih Transfer Bank (0% biaya admin) sekaligus rekening pencairan jika menggunakan Midtrans VA/QRIS.
                      </p>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Nama Bank</label>
                      <input
                        type="text"
                        list="indo-bank-options"
                        value={schoolForm.bankName}
                        onChange={(e) => setSchoolForm((p) => ({ ...p, bankName: e.target.value }))}
                        placeholder="BCA / Bank Mandiri / BRI"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                      <datalist id="indo-bank-options">
                        {INDONESIAN_BANKS.map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Nomor Rekening</label>
                      <input
                        type="text"
                        value={schoolForm.bankAccountNumber}
                        onChange={(e) => setSchoolForm((p) => ({ ...p, bankAccountNumber: e.target.value }))}
                        placeholder="Contoh: 1300012345678"
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Atas Nama Rekening</label>
                      <input
                        type="text"
                        value={schoolForm.bankAccountHolder}
                        onChange={(e) => setSchoolForm((p) => ({ ...p, bankAccountHolder: e.target.value }))}
                        placeholder="Yayasan / Nama Resmi Sekolah"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                  >
                    {savingSettings ? 'Menyimpan...' : 'Simpan Konfigurasi Sekolah'}
                  </button>
                </div>
              </form>
            </div>

            {/* Status Payment Gateway Midtrans */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-[#2563EB] shrink-0" />
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Integrasi Payment Gateway Virtual Account &amp; QRIS (Midtrans Core API v2)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Menghasilkan nomor VA BCA/Mandiri/BRI/BNI/Permata &amp; QRIS asli yang terverifikasi otomatis oleh bank.
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap self-start sm:self-auto ${
                    gatewayConfig?.midtransConfigured
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {gatewayConfig?.midtransConfigured
                    ? gatewayConfig.isProduction
                      ? 'Terhubung · Production (Live)'
                      : 'Terhubung · Sandbox (Uji Coba)'
                    : 'Menunggu MIDTRANS_SERVER_KEY'}
                </span>
              </div>

              {gatewayConfig?.webhookUrl && (
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700">
                      Payment Notification URL (Webhook Midtrans)
                    </p>
                    <p className="font-mono text-xs text-slate-600 truncate mt-0.5">
                      {gatewayConfig.webhookUrl}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(gatewayConfig.webhookUrl);
                      setCopiedWebhook(true);
                      setTimeout(() => setCopiedWebhook(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 self-start sm:self-auto"
                  >
                    {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedWebhook ? 'Tersalin' : 'Salin URL Webhook'}
                  </button>
                </div>
              )}
            </div>

            {/* Master Tarif Fleksibel per Kelas & Zona */}
            <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Master Tarif Fleksibel per Kelas &amp; Zona
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tetapkan nominal berbeda untuk setiap kelas (TK A, Kelas 1–6, Kelas 7–9, Kelas 10–12) atau zona jemputan sesuai kebijakan sekolah.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateTemplate}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] whitespace-nowrap shrink-0 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Tarif Baru
                </button>
              </div>

              {feeTemplates.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Belum ada master tarif. Tambahkan tarif SPP, Daftar Ulang, atau Jemputan per kelas sesuai jenjang sekolah Anda.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Kategori</th>
                        <th className="text-left font-medium px-4 py-3">Nama Tarif</th>
                        <th className="text-left font-medium px-4 py-3">Jenjang &amp; Kelas / Zona</th>
                        <th className="text-right font-medium px-4 py-3">Nominal</th>
                        <th className="text-right font-medium px-4 py-3">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {feeTemplates.map((tpl) => (
                        <tr key={tpl.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3 text-xs font-medium text-[#1D4ED8]">
                            {CATEGORY_LABELS[tpl.category]}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">{tpl.name}</td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {tpl.level === 'ALL' ? 'Semua Jenjang' : tpl.level} · {tpl.grade}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                            {formatRupiah(tpl.amount)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditTemplate(tpl)}
                                className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                                aria-label="Edit tarif"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteTemplate(tpl.id)}
                                className="p-1.5 text-red-600 hover:text-red-800 rounded-lg hover:bg-red-50"
                                aria-label="Hapus tarif"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: DATA SISWA & WALI */}
        {activeTab === 'students' && (
          <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-panel-enter">
            <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">Data Siswa &amp; Wali Murid</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tautkan email Google Wali Murid, impor massal dari Excel/CSV, atau proses kenaikan kelas tahunan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setPromoteLevel('ALL');
                    setPromoteGrade('ALL');
                    setShowPromoteModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 whitespace-nowrap"
                >
                  <GraduationCap className="w-3.5 h-3.5 text-[#2563EB]" />
                  Naik Kelas / Lulus
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setImportFileError('');
                    setImportRows([]);
                    setShowImportModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5 text-[#2563EB]" />
                  Import Excel
                </button>
                <button
                  type="button"
                  onClick={openCreateStudent}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] whitespace-nowrap transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Siswa
                </button>
              </div>
            </div>

            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setStudentLevelFilter('all')}
                    className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                      studentLevelFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Semua
                  </button>
                  {school.enabledLevels.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setStudentLevelFilter(lvl)}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                        studentLevelFilter === lvl ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
                <select
                  value={studentStatusFilter}
                  onChange={(e) => setStudentStatusFilter(e.target.value as 'active' | 'graduated' | 'all')}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="active">Siswa Aktif</option>
                  <option value="graduated">Lulus / Alumni</option>
                  <option value="all">Semua Status</option>
                </select>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Cari NIS, siswa, atau email wali..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>

            {filteredStudents.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500">
                Belum ada data siswa yang cocok. Klik &ldquo;Tambah Siswa&rdquo; atau &ldquo;Import Excel&rdquo; untuk mendaftarkan siswa baru.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">NIS &amp; Nama Siswa</th>
                      <th className="text-left font-medium px-4 py-3">Jenjang / Kelas</th>
                      <th className="text-left font-medium px-4 py-3">Wali Murid</th>
                      <th className="text-left font-medium px-4 py-3">Layanan &amp; Tarif Khusus</th>
                      <th className="text-right font-medium px-4 py-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.map((stu) => {
                      const stuActiveInvoices = invoices.filter(
                        (inv) => inv.studentId === stu.id && inv.status !== 'paid',
                      );
                      const stuRemaining = stuActiveInvoices.reduce(
                        (s, inv) => s + getInvoiceRemainingAmount(inv),
                        0,
                      );
                      const waReminder =
                        stuActiveInvoices.length > 0
                          ? buildWhatsAppReminder({
                              phone: stu.parentPhone,
                              school,
                              studentName: stu.name,
                              studentNis: stu.nis,
                              studentGrade: `${stu.level} ${stu.grade}`,
                              parentName: stu.parentName,
                              invoices: stuActiveInvoices,
                            })
                          : null;

                      return (
                        <tr key={stu.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-slate-900">{stu.name}</p>
                              {stu.status === 'graduated' && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 rounded">
                                  Lulus
                                </span>
                              )}
                            </div>
                            <p className="text-xs font-mono text-slate-500 tabular-nums mt-0.5">{stu.nis}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">
                            {stu.level} · {stu.grade}
                            {stu.className ? ` (${stu.className})` : ''}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-medium text-slate-900">{stu.parentName}</p>
                            <p className="text-xs font-mono text-slate-500 mt-0.5">{stu.parentEmail}</p>
                            {stu.parentPhone && (
                              <p className="text-[11px] font-mono text-slate-500 mt-0.5">{stu.parentPhone}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            <div>
                              {stu.customSppAmount > 0
                                ? `SPP Khusus: ${formatRupiah(stu.customSppAmount)}`
                                : 'SPP ikut tarif kelas'}
                            </div>
                            {stuActiveInvoices.length > 0 && (
                              <div className="text-amber-700 font-medium mt-0.5">
                                {stuActiveInvoices.length} tagihan aktif · {formatRupiah(stuRemaining)}
                              </div>
                            )}
                            {school.enabledModules.jemputan && (
                              <div className="text-slate-500 mt-0.5">
                                {stu.useShuttle
                                  ? `Jemputan: ${stu.shuttleZone || 'Aktif'}`
                                  : 'Tidak ikut jemputan'}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {waReminder &&
                                (waReminder.url ? (
                                  <a
                                    href={waReminder.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Kirim pengingat tagihan via WhatsApp"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    WA
                                  </a>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCopiedWaMsg(false);
                                      setWaFallbackModal({
                                        title: `Pengingat Tagihan (${stuActiveInvoices.length} item)`,
                                        studentName: stu.name,
                                        message: waReminder.message,
                                      });
                                    }}
                                    title="Salin pesan pengingat tagihan (No. WA belum diisi)"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                                  >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    WA
                                  </button>
                                ))}
                              <button
                                type="button"
                                onClick={() => openEditStudent(stu)}
                                className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                                aria-label="Edit siswa"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setErrorMsg('');
                                  setDeleteStudentTarget(stu);
                                }}
                                className="p-1.5 text-red-600 hover:text-red-800 rounded-lg hover:bg-red-50"
                                aria-label="Hapus siswa"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TAGIHAN RUTIN & MANUAL */}
        {activeTab === 'billing' && (
          <div className="space-y-6 animate-panel-enter">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">Penerbitan Tagihan Siswa</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Terbitkan tagihan rutin sesuai modul aktif atau buat tagihan manual bebas untuk kebutuhan khusus.
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl self-start">
                  <button
                    type="button"
                    onClick={() => setBillingMode('mass')}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                      billingMode === 'mass' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tagihan Rutin (Massal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingMode('manual')}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                      billingMode === 'manual' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tagihan Manual (Bebas)
                  </button>
                </div>
              </div>

              {billingMode === 'mass' ? (
                enabledTemplateCategories.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Semua modul rutin (SPP, Daftar Ulang, Jemputan) sedang nonaktif. Aktifkan di tab Jenjang &amp; Tarif atau gunakan Tagihan Manual.
                  </p>
                ) : (
                  <form onSubmit={handleGenerateMassInvoices} className="space-y-4">
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Jenis Tagihan (Modul Aktif)
                        </label>
                        <select
                          value={massCategory}
                          onChange={(e) => setMassCategory(e.target.value as TemplateCategory)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                        >
                          {enabledTemplateCategories.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                        {massCategory === 'daftar_ulang' ? (
                          <input
                            type="text"
                            value={massPeriod}
                            onChange={(e) => setMassPeriod(e.target.value)}
                            placeholder="TA 2026/2027"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                          />
                        ) : (
                          <select
                            value={massPeriod}
                            onChange={(e) => setMassPeriod(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                          >
                            {monthOptions.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Jatuh Tempo</label>
                        <input
                          type="date"
                          required
                          value={massDueDate}
                          onChange={(e) => setMassDueDate(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Target Jenjang</label>
                        <select
                          value={massTargetLevel}
                          onChange={(e) => {
                            setMassTargetLevel(e.target.value as 'ALL' | SchoolLevel);
                            setMassTargetGrade('ALL');
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                        >
                          <option value="ALL">Semua Jenjang Aktif</option>
                          {school.enabledLevels.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Target Kelas</label>
                        <select
                          value={massTargetGrade}
                          onChange={(e) => setMassTargetGrade(e.target.value)}
                          disabled={massTargetLevel === 'ALL'}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white disabled:bg-slate-50 focus:outline-none focus:border-[#2563EB]"
                        >
                          <option value="ALL">Semua Kelas</option>
                          {massTargetLevel !== 'ALL' &&
                            LEVEL_GRADES[massTargetLevel].map((g) => (
                              <option key={g} value={g}>
                                {g}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Nominal Default jika belum ada Master Tarif
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={massFallbackAmount}
                          onChange={(e) => setMassFallbackAmount(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                      <p className="text-xs text-slate-500">
                        Sistem otomatis memprioritaskan tarif khusus siswa → tarif kelas di Master Tarif → nominal default.
                      </p>
                      <button
                        type="submit"
                        disabled={generatingInvoices}
                        className="px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
                      >
                        {generatingInvoices ? 'Menerbitkan...' : 'Terbitkan Tagihan Massal'}
                      </button>
                    </div>
                  </form>
                )
              ) : (
                <form onSubmit={handleCreateManualInvoice} className="space-y-4">
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Nama / Item Tagihan Manual
                      </label>
                      <input
                        type="text"
                        required
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        placeholder="Contoh: Seragam Batik, Study Tour, Buku Paket, Ujian Praktik"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Nominal Fleksibel (Rp)
                      </label>
                      <input
                        type="number"
                        required
                        min={1000}
                        value={manualAmount}
                        onChange={(e) => setManualAmount(e.target.value)}
                        placeholder="250000"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Sasaran Tagihan</label>
                      <select
                        value={manualTargetType}
                        onChange={(e) => setManualTargetType(e.target.value as 'single' | 'level' | 'all')}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                      >
                        <option value="single">1 Siswa Tertentu</option>
                        <option value="level">Satu Jenjang</option>
                        <option value="all">Seluruh Siswa Aktif</option>
                      </select>
                    </div>

                    {manualTargetType === 'single' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Pilih Siswa</label>
                        <select
                          value={manualStudentId}
                          onChange={(e) => setManualStudentId(e.target.value)}
                          required
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                        >
                          <option value="">-- Pilih Siswa --</option>
                          {students
                            .filter((s) => s.status === 'active')
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.nis} · {s.grade})
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    {manualTargetType === 'level' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Pilih Jenjang</label>
                        <select
                          value={manualLevel}
                          onChange={(e) => setManualLevel(e.target.value as SchoolLevel)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                        >
                          {school.enabledLevels.map((lvl) => (
                            <option key={lvl} value={lvl}>
                              {lvl}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Jatuh Tempo</label>
                      <input
                        type="date"
                        required
                        value={manualDueDate}
                        onChange={(e) => setManualDueDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Label Periode / Keterangan Singkat</label>
                      <input
                        type="text"
                        value={manualPeriod}
                        onChange={(e) => setManualPeriod(e.target.value)}
                        placeholder="Insidental / Semester 1"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Catatan Tambahan (Opsional)</label>
                      <input
                        type="text"
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                        placeholder="Misal: Ukuran seragam L, dibayar sebelum acara"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={generatingInvoices}
                      className="px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                    >
                      {generatingInvoices ? 'Menyimpan...' : 'Buat Tagihan Manual'}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Daftar Tagihan Sekolah */}
            <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Daftar Seluruh Tagihan ({filteredInvoices.length})
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={invCategoryFilter}
                    onChange={(e) => setInvCategoryFilter(e.target.value as 'all' | FeeCategory)}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="all">Semua Kategori</option>
                    <option value="spp">SPP Bulanan</option>
                    <option value="daftar_ulang">Daftar Ulang</option>
                    <option value="jemputan">Jemputan</option>
                    <option value="manual">Tagihan Manual</option>
                  </select>
                  <select
                    value={invStatusFilter}
                    onChange={(e) => setInvStatusFilter(e.target.value as typeof invStatusFilter)}
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="all">Semua Status</option>
                    <option value="unpaid">Belum Bayar</option>
                    <option value="pending_payment">Menunggu VA/QRIS</option>
                    <option value="paid">Lunas</option>
                  </select>
                  <input
                    type="text"
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                    placeholder="Cari siswa / judul..."
                    className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl w-48 focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-left font-medium px-4 py-3">Siswa</th>
                      <th className="text-left font-medium px-4 py-3">Tagihan</th>
                      <th className="text-left font-medium px-4 py-3">Jatuh Tempo</th>
                      <th className="text-right font-medium px-4 py-3">Nominal</th>
                      <th className="text-left font-medium px-4 py-3">Status</th>
                      <th className="text-right font-medium px-4 py-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((inv) => {
                      const rem = getInvoiceRemainingAmount(inv);
                      const paid = getInvoicePaidAmount(inv);
                      const matchedStudent = students.find((s) => s.id === inv.studentId);
                      const waItem =
                        inv.status !== 'paid'
                          ? buildWhatsAppReminder({
                              phone: matchedStudent?.parentPhone,
                              school,
                              studentName: inv.studentName,
                              studentNis: inv.studentNis,
                              studentGrade: `${inv.studentLevel} ${inv.studentGrade}`,
                              parentName: inv.parentName,
                              invoices: [inv],
                            })
                          : null;

                      return (
                        <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{inv.studentName}</p>
                            <p className="text-xs text-slate-500 font-mono">
                              {inv.studentNis} · {inv.studentLevel} {inv.studentGrade}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{inv.title}</p>
                            <p className="text-xs text-slate-500">
                              {CATEGORY_LABELS[inv.category]} · {formatPeriodLabel(inv.period)}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                            {formatDateId(inv.dueDate)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                            {inv.status === 'paid' ? (
                              formatRupiah(inv.amount)
                            ) : (
                              <div>
                                <p>{formatRupiah(rem)}</p>
                                {paid > 0 && (
                                  <p className="text-[11px] font-normal text-[#2563EB]">
                                    Terbayar {formatRupiah(paid)} / {formatRupiah(inv.amount)}
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            <span
                              className={
                                inv.status === 'paid'
                                  ? 'text-emerald-700'
                                  : inv.status === 'pending_payment'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                              }
                            >
                              {STATUS_LABELS[inv.status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {inv.status !== 'paid' ? (
                              <div className="inline-flex items-center gap-1">
                                {waItem &&
                                  (waItem.url ? (
                                    <a
                                      href={waItem.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Kirim pengingat via WhatsApp"
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                                    >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                      WA
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCopiedWaMsg(false);
                                        setWaFallbackModal({
                                          title: `Pengingat: ${inv.title}`,
                                          studentName: inv.studentName,
                                          message: waItem.message,
                                        });
                                      }}
                                      title="Salin pesan pengingat tagihan (No. WA belum diisi)"
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                                    >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                      WA
                                    </button>
                                  ))}
                                {inv.status === 'unpaid' && (
                                  <button
                                    type="button"
                                    onClick={() => openEditInvoice(inv)}
                                    className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
                                    aria-label="Edit tagihan"
                                    title="Edit judul, nominal, atau jatuh tempo tagihan"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteUnpaidInvoice(inv)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                                  aria-label="Hapus tagihan"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs font-mono text-slate-400">
                                {inv.receiptNumber}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: KASIR TUNAI & VERIFIKASI VA/QRIS */}
        {activeTab === 'cashier' && (
          <div className="space-y-6 animate-panel-enter">
            <div className="grid lg:grid-cols-12 gap-6 items-start">
              {/* Pilih Siswa */}
              <div className="lg:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-lg bg-[#2563EB] text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    01
                  </span>
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900">Cari &amp; Pilih Siswa</h2>
                    <p className="text-xs text-slate-500">Loket pembayaran tunai maupun kode VA/QRIS.</p>
                  </div>
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={cashierSearch}
                    onChange={(e) => setCashierSearch(e.target.value)}
                    placeholder="Ketik nama atau NIS siswa..."
                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {cashierStudents.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 text-center">Siswa tidak ditemukan.</p>
                  ) : (
                    cashierStudents.map((stu) => {
                      const active = stu.id === cashierStudentId;
                      const unpaidCnt = invoices.filter(
                        (i) => i.studentId === stu.id && i.status !== 'paid',
                      ).length;
                      return (
                        <button
                          key={stu.id}
                          type="button"
                          onClick={() => {
                            setCashierStudentId(stu.id);
                            setCashierInvoiceIds([]);
                            setCashierPaymentMode('full');
                            setCashierPartialInput('');
                          }}
                          className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between transition-colors ${
                            active ? 'bg-[#EEF4FF] text-[#2563EB]' : 'bg-white hover:bg-slate-50 text-slate-900'
                          }`}
                        >
                          <div>
                            <p className="text-xs font-semibold">{stu.name}</p>
                            <p className={`text-[11px] font-mono ${active ? 'text-[#2563EB]/80' : 'text-slate-500'}`}>
                              {stu.nis} · {stu.level} {stu.grade}
                            </p>
                          </div>
                          <span className={`text-[11px] font-mono ${active ? 'text-[#2563EB] font-semibold' : 'text-slate-500'}`}>
                            {unpaidCnt} tagihan
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Detail Tagihan & Proses Kasir */}
              <div className="lg:col-span-7 bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-lg bg-[#2563EB] text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    02
                  </span>
                  <div>
                    <h2 className="font-display text-sm font-bold text-slate-900">
                      Pilih Tagihan &amp; Terima Pembayaran
                    </h2>
                    <p className="text-xs text-slate-500">
                      {selectedCashierStudent
                        ? `${selectedCashierStudent.name} (${selectedCashierStudent.nis} · ${selectedCashierStudent.grade})`
                        : 'Pilih siswa di panel kiri untuk melihat tagihan belum lunas.'}
                    </p>
                  </div>
                </div>

                {selectedCashierStudent && (
                  <>
                    {cashierStudentInvoices.length === 0 ? (
                      <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                        Tidak ada tagihan yang belum dibayar untuk siswa ini.
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                        {cashierStudentInvoices.map((inv) => {
                          const checked = cashierInvoiceIds.includes(inv.id);
                          const rem = getInvoiceRemainingAmount(inv);
                          const paid = getInvoicePaidAmount(inv);
                          return (
                            <label
                              key={inv.id}
                              className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                                checked ? 'bg-[#EEF4FF]/70' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setCashierPaymentMode('full');
                                    setCashierPartialInput('');
                                    setCashierInvoiceIds((prev) =>
                                      prev.includes(inv.id)
                                        ? prev.filter((id) => id !== inv.id)
                                        : [...prev, inv.id],
                                    );
                                  }}
                                  className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                                />
                                <div>
                                  <p className="text-xs font-semibold text-slate-900">{inv.title}</p>
                                  <p className="text-[11px] text-slate-500">
                                    {CATEGORY_LABELS[inv.category]} · Jatuh tempo {formatDateId(inv.dueDate)}
                                    {paid > 0 && (
                                      <span className="text-[#2563EB] font-medium">
                                        {' '}· Terbayar {formatRupiah(paid)} / {formatRupiah(inv.amount)}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                {formatRupiah(rem)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {canCashierPartial && (
                      <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-800">
                            Skema Pembayaran Tunai
                          </span>
                          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
                            <button
                              type="button"
                              onClick={() => setCashierPaymentMode('full')}
                              className={`px-3 py-1 text-xs font-medium rounded-md ${
                                cashierPaymentMode === 'full'
                                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                                  : 'text-slate-600'
                              }`}
                            >
                              Bayar Lunas
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setCashierPaymentMode('partial');
                                if (!cashierPartialInput) {
                                  setCashierPartialInput(
                                    String(Math.round(getInvoiceRemainingAmount(selectedCashierInvoices[0]) / 2)),
                                  );
                                }
                              }}
                              className={`px-3 py-1 text-xs font-medium rounded-md ${
                                cashierPaymentMode === 'partial'
                                  ? 'bg-white text-[#1D4ED8] shadow-xs font-semibold'
                                  : 'text-slate-600'
                              }`}
                            >
                              Cicil / Sebagian
                            </button>
                          </div>
                        </div>
                        {cashierPaymentMode === 'partial' && (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min={1000}
                              max={getInvoiceRemainingAmount(selectedCashierInvoices[0])}
                              value={cashierPartialInput}
                              onChange={(e) => setCashierPartialInput(e.target.value)}
                              placeholder="Nominal cicilan tunai"
                              className="flex-1 min-w-[160px] px-3 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#2563EB]"
                            />
                            <span className="text-[11px] text-slate-600">
                              Sisa setelah bayar:{' '}
                              <span className="font-mono font-semibold text-slate-900">
                                {formatRupiah(
                                  Math.max(
                                    0,
                                    getInvoiceRemainingAmount(selectedCashierInvoices[0]) - parsedCashierPartial,
                                  ),
                                )}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Catatan Kasir (Opsional)
                      </label>
                      <input
                        type="text"
                        value={cashierNotes}
                        onChange={(e) => setCashierNotes(e.target.value)}
                        placeholder="Misal: Dibayar oleh Ibu Ratna di loket"
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>

                    <div className="bg-gradient-to-br from-[#132652] via-[#1B3C7C] to-[#244FA3] text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_12px_28px_-14px_rgba(27,60,124,0.65)]">
                      <div>
                        <p className="text-[11px] uppercase tracking-wider text-blue-200/80">
                          Total Dibayar ({selectedCashierInvoices.length} item)
                        </p>
                        <p className="text-lg font-mono font-bold text-white tabular-nums mt-0.5">
                          {formatRupiah(cashierTotal)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={selectedCashierInvoices.length === 0 || settlingCash}
                          onClick={() => setCounterCheckoutInvoices(selectedCashierInvoices)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-white bg-white/12 border border-white/20 rounded-xl hover:bg-white/20 disabled:opacity-50 whitespace-nowrap transition-colors"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          Transfer / VA / QRIS
                        </button>
                        <button
                          type="button"
                          disabled={selectedCashierInvoices.length === 0 || settlingCash}
                          onClick={() => void handleSettleCash()}
                          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-slate-900 bg-white rounded-xl hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap transition-colors shadow-sm"
                        >
                          <Banknote className="w-3.5 h-3.5 text-[#2563EB]" />
                          {settlingCash ? 'Memproses...' : 'Terima Tunai & Cetak Kuitansi'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Antrean Verifikasi Transfer Bank, VA & QRIS Pending */}
            <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-display text-base font-bold text-slate-900">
                  Verifikasi Transfer Bank, VA &amp; QRIS Menunggu ({pendingDigitalTxs.length})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cocokkan mutasi rekening sekolah &amp; foto bukti transfer dari wali murid, atau periksa status VA/QRIS dari Midtrans.
                </p>
              </div>
              {pendingDigitalTxs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Tidak ada transaksi Transfer Bank, VA, atau QRIS yang menunggu konfirmasi.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {pendingDigitalTxs.map((tx) => (
                    <div
                      key={tx.id}
                      className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {tx.studentName} · <span className="font-mono">{formatRupiah(tx.totalAmount)}</span>
                          </p>
                          <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                            {ACTIVE_METHOD_LABELS[tx.method]}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {tx.channelDetail}
                          {tx.vaBillerCode ? ` (Biller ${tx.vaBillerCode})` : ''}
                          {tx.vaNumber ? ` (${tx.vaNumber})` : ''} · {tx.invoiceTitles.join(', ')}
                        </p>
                        {tx.method === 'bank_transfer' && (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-lg px-2.5 py-1.5 inline-block">
                              Pengirim: <span className="font-semibold">{tx.transferSenderName || '-'}</span>
                              {tx.transferReference ? ` · Ref/Catatan: ${tx.transferReference}` : ''}
                              {tx.bankAccountNumber ? ` · Ke: ${tx.bankName || 'Bank'} ${tx.bankAccountNumber}` : ''}
                            </p>
                            {tx.transferProofDataUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewProofTx(tx)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-[#1D4ED8] bg-[#EEF4FF] border border-blue-200 rounded-lg hover:bg-blue-100"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                                Lihat Foto Bukti
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {tx.gatewayOrderId && (
                          <button
                            type="button"
                            disabled={processingTxId === tx.id}
                            onClick={async () => {
                              setErrorMsg('');
                              setProcessingTxId(tx.id);
                              try {
                                const res = await checkMidtransPaymentStatus(tx.gatewayOrderId!);
                                if (res.isSettled) {
                                  const settled = await settleDigitalPayment(tx, userUid, res.settlementTime);
                                  setReceiptTx(settled);
                                  setToastMsg(`Pembayaran ${settled.receiptNumber} terverifikasi lunas oleh Midtrans.`);
                                } else if (res.isCancelledOrExpired) {
                                  await cancelDigitalPayment(tx);
                                  setToastMsg(`Sesi ${tx.receiptNumber} kedaluwarsa/dibatalkan di Midtrans.`);
                                } else {
                                  setToastMsg(`Status bank saat ini: Menunggu transfer (${res.transactionStatus}).`);
                                }
                              } catch (err) {
                                setErrorMsg(
                                  err instanceof Error
                                    ? err.message
                                    : 'Gagal mengecek status pembayaran dari Midtrans.',
                                );
                              } finally {
                                setProcessingTxId('');
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            {processingTxId === tx.id ? 'Mengecek...' : 'Cek Status Bank'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={processingTxId === tx.id}
                          onClick={async () => {
                            setErrorMsg('');
                            setProcessingTxId(tx.id);
                            try {
                              const settled = await settleDigitalPayment(tx, userUid);
                              setReceiptTx(settled);
                              setToastMsg(`Transaksi ${settled.receiptNumber} berhasil dikonfirmasi lunas.`);
                            } catch (err) {
                              setErrorMsg(
                                err instanceof Error
                                  ? err.message
                                  : 'Gagal mengonfirmasi pelunasan transaksi.',
                              );
                            } finally {
                              setProcessingTxId('');
                            }
                          }}
                          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl disabled:opacity-50 ${
                            tx.method === 'bank_transfer'
                              ? 'text-white bg-[#2563EB] hover:bg-[#1D4ED8]'
                              : 'text-[#1D4ED8] bg-[#EEF4FF] border border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {tx.method === 'bank_transfer'
                            ? 'Mutasi Masuk · Konfirmasi Lunas'
                            : 'Verifikasi Manual'}
                        </button>
                        <button
                          type="button"
                          disabled={processingTxId === tx.id}
                          onClick={async () => {
                            setErrorMsg('');
                            setProcessingTxId(tx.id);
                            try {
                              await cancelDigitalPayment(tx);
                              setToastMsg(
                                tx.method === 'bank_transfer'
                                  ? 'Konfirmasi transfer ditolak / dibatalkan; tagihan kembali Belum Bayar.'
                                  : 'Sesi pembayaran dibatalkan.',
                              );
                            } catch (err) {
                              setErrorMsg(
                                err instanceof Error
                                  ? err.message
                                  : 'Gagal membatalkan sesi pembayaran.',
                              );
                            } finally {
                              setProcessingTxId('');
                            }
                          }}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50"
                        >
                          {tx.method === 'bank_transfer' ? 'Tolak / Batalkan' : 'Batalkan'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: LAPORAN AKHIR EXCEL & PDF KERTAS A4 */}
        {activeTab === 'reports' && (
          <div className="space-y-6 animate-panel-enter">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Laporan Akhir Keuangan Sekolah
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Unduh laporan rapi sesuai kop surat dan struktur {school.name} dalam format Excel (.xlsx) atau PDF Kertas A4.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      exportSchoolReportExcel({
                        school,
                        periodLabel: reportData.periodLabel,
                        filterSummary: reportData.filterSummary,
                        settledTransactions: reportData.settled,
                        unpaidInvoices: reportData.unpaidInvs,
                        paidInvoices: reportData.paidInvs,
                      })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
                    Download Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportSchoolReportPdfA4({
                        school,
                        periodLabel: reportData.periodLabel,
                        filterSummary: reportData.filterSummary,
                        settledTransactions: reportData.settled,
                        unpaidInvoices: reportData.unpaidInvs,
                        paidInvoices: reportData.paidInvs,
                      })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    Download PDF Kertas A4
                  </button>
                </div>
              </div>

              {/* Filter Laporan */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                  <select
                    value={reportPeriod}
                    onChange={(e) => setReportPeriod(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="ALL">Semua Periode</option>
                    {monthOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenjang</label>
                  <select
                    value={reportLevel}
                    onChange={(e) => setReportLevel(e.target.value as 'ALL' | SchoolLevel)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="ALL">Semua Jenjang Aktif</option>
                    {school.enabledLevels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                  <select
                    value={reportCategory}
                    onChange={(e) => setReportCategory(e.target.value as 'ALL' | FeeCategory)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="ALL">Semua Kategori</option>
                    <option value="spp">SPP Bulanan</option>
                    <option value="daftar_ulang">Daftar Ulang</option>
                    <option value="jemputan">Jemputan</option>
                    <option value="manual">Tagihan Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Metode Bayar</label>
                  <select
                    value={reportMethod}
                    onChange={(e) => setReportMethod(e.target.value as 'ALL' | ActivePaymentMethod)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="ALL">Semua Metode</option>
                    <option value="cash">Kasir Tunai</option>
                    <option value="bank_transfer">Transfer Bank</option>
                    <option value="va">Virtual Account</option>
                    <option value="qris">QRIS</option>
                  </select>
                </div>
              </div>

              {/* Pratinjau Lembar Kertas A4 */}
              <div className="bg-slate-100/80 border border-slate-200/80 rounded-2xl p-4 sm:p-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                  <div className="h-1.5 w-full bg-[#2563EB]" />
                  <div className="p-6 space-y-5">
                    <div className="text-center border-b-2 border-slate-900 pb-4">
                      <p className="font-display text-base font-bold text-slate-900 uppercase tracking-wide">
                        {school.name}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Jenjang {school.enabledLevels.join(' · ')} · {school.address || '-'}
                        {school.npsn ? ` · NPSN ${school.npsn}` : ''}
                      </p>
                      <p className="text-xs font-bold text-[#1D4ED8] uppercase tracking-wider mt-3">
                        LAPORAN REKAPITULASI KEUANGAN ({reportData.periodLabel})
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-3 border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-sm">
                      <div className="p-4">
                        <p className="text-xs text-slate-500">Total Penerimaan Lunas</p>
                        <p className="text-lg font-mono font-bold text-[#2563EB] tabular-nums mt-1">
                          {formatRupiah(reportData.settled.reduce((s, t) => s + t.totalAmount, 0))}
                        </p>
                      </div>
                      <div className="p-4">
                        <p className="text-xs text-slate-500">Jumlah Transaksi Lunas</p>
                        <p className="text-lg font-mono font-bold text-slate-900 tabular-nums mt-1">
                          {reportData.settled.length}
                        </p>
                      </div>
                      <div className="p-4">
                        <p className="text-xs text-slate-500">Total Piutang Belum Lunas</p>
                        <p className="text-lg font-mono font-bold text-amber-700 tabular-nums mt-1">
                          {formatRupiah(
                            reportData.unpaidInvs.reduce(
                              (s, i) => s + getInvoiceRemainingAmount(i),
                              0,
                            ),
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabel Rincian Transaksi */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="text-left font-medium px-4 py-3">Tanggal</th>
                        <th className="text-left font-medium px-4 py-3">No. Kuitansi</th>
                        <th className="text-left font-medium px-4 py-3">Siswa</th>
                        <th className="text-left font-medium px-4 py-3">Rincian</th>
                        <th className="text-left font-medium px-4 py-3">Metode</th>
                        <th className="text-right font-medium px-4 py-3">Nominal</th>
                        <th className="text-right font-medium px-4 py-3">Kuitansi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.settled.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                            Belum ada transaksi lunas pada filter yang dipilih.
                          </td>
                        </tr>
                      ) : (
                        reportData.settled.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              {formatDateTimeId(tx.settledAt)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-900 tabular-nums whitespace-nowrap">
                              {tx.receiptNumber}
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">{tx.studentName}</p>
                              <p className="text-xs text-slate-500">
                                {tx.studentNis} · {tx.studentLevel} {tx.studentGrade}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700">
                              {tx.invoiceTitles.join(', ')}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                              {ACTIVE_METHOD_LABELS[tx.method]}
                            </td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              {formatRupiah(tx.totalAmount)}
                            </td>
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setReceiptTx(tx)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                              >
                                <Receipt className="w-3 h-3" />
                                Lihat
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal Tambah / Edit Master Tarif */}
      {showTemplateModal &&
        createPortal(
          <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowTemplateModal(false);
          }}
        >
          <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
            <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingTemplate ? 'Edit Tarif Fleksibel' : 'Tambah Tarif Fleksibel'}
              </h3>
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal tarif"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveTemplate} className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                  {errorMsg}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                <select
                  value={tplCategory}
                  onChange={(e) => setTplCategory(e.target.value as TemplateCategory)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="spp">SPP Bulanan</option>
                  <option value="daftar_ulang">Daftar Ulang</option>
                  <option value="jemputan">Jemputan</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nama Tarif</label>
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="Contoh: SPP Kelas 1 SD atau Jemputan Zona A"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenjang</label>
                  <select
                    value={tplLevel}
                    onChange={(e) => {
                      const val = e.target.value as SchoolLevel | 'ALL';
                      setTplLevel(val);
                      if (val !== 'ALL') {
                        setTplGrade(LEVEL_GRADES[val][0]);
                      } else {
                        setTplGrade('Semua Kelas');
                      }
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="ALL">Semua Jenjang</option>
                    {school.enabledLevels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {tplCategory === 'jemputan' ? 'Zona Jemputan' : 'Kelas / Tingkat'}
                  </label>
                  <input
                    type="text"
                    required
                    value={tplGrade}
                    onChange={(e) => setTplGrade(e.target.value)}
                    placeholder={tplCategory === 'jemputan' ? 'Zona A' : 'Kelas 1'}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (Rp)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={tplAmount}
                    onChange={(e) => setTplAmount(e.target.value)}
                    placeholder="450000"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Siklus</label>
                  <select
                    value={tplCycle}
                    onChange={(e) => setTplCycle(e.target.value as 'monthly' | 'annual' | 'one_time')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="monthly">Bulanan</option>
                    <option value="annual">Tahunan</option>
                    <option value="one_time">Sekali Bayar</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
                >
                  Simpan Tarif
                </button>
              </div>
            </form>
          </div>
        </div>,
          document.body,
        )}

      {/* Modal Tambah / Edit Siswa */}
      {showStudentModal &&
        createPortal(
          <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStudentModal(false);
          }}
        >
          <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
            <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingStudent ? `Edit Siswa: ${editingStudent.name}` : 'Tambah Siswa Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setShowStudentModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal siswa"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveStudent} className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                  {errorMsg}
                </div>
              )}
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">NIS</label>
                  <input
                    type="text"
                    required
                    value={stuNis}
                    onChange={(e) => setStuNis(e.target.value)}
                    placeholder="20260101"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Lengkap Siswa</label>
                  <input
                    type="text"
                    required
                    value={stuName}
                    onChange={(e) => setStuName(e.target.value)}
                    placeholder="Nadia Putri Pratama"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jenjang</label>
                  <select
                    value={stuLevel}
                    onChange={(e) => {
                      const val = e.target.value as SchoolLevel;
                      setStuLevel(val);
                      setStuGrade(LEVEL_GRADES[val][0]);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    {school.enabledLevels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Tingkat / Kelas</label>
                  <select
                    value={stuGrade}
                    onChange={(e) => setStuGrade(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    {LEVEL_GRADES[stuLevel].map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Rombel (Opsional)</label>
                  <input
                    type="text"
                    value={stuClassName}
                    onChange={(e) => setStuClassName(e.target.value)}
                    placeholder="1A"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Wali Murid</label>
                  <input
                    type="text"
                    required
                    value={stuParentName}
                    onChange={(e) => setStuParentName(e.target.value)}
                    placeholder="Bapak / Ibu..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Google Wali</label>
                  <input
                    type="email"
                    required
                    value={stuParentEmail}
                    onChange={(e) => setStuParentEmail(e.target.value)}
                    placeholder="wali@gmail.com"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">No. HP / WA</label>
                  <input
                    type="text"
                    value={stuParentPhone}
                    onChange={(e) => setStuParentPhone(e.target.value)}
                    placeholder="0812-xxxx"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

                <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tarif SPP Khusus Siswa (0 = ikut tarif kelas)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={stuCustomSpp}
                    onChange={(e) => setStuCustomSpp(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tarif Jemputan Khusus (0 = ikut tarif zona)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={stuCustomShuttle}
                    onChange={(e) => setStuCustomShuttle(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              {editingStudent && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Status Keaktifan Siswa
                  </label>
                  <select
                    value={stuStatus}
                    onChange={(e) =>
                      setStuStatus(e.target.value as 'active' | 'graduated' | 'inactive')
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="active">Aktif</option>
                    <option value="graduated">Lulus / Alumni</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              )}

              {school.enabledModules.jemputan && (
                <div className="grid sm:grid-cols-2 gap-3 items-center">
                  <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stuUseShuttle}
                      onChange={(e) => setStuUseShuttle(e.target.checked)}
                      className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                    />
                    Siswa mengikuti layanan Jemputan
                  </label>
                  {stuUseShuttle && (
                    <input
                      type="text"
                      value={stuShuttleZone}
                      onChange={(e) => setStuShuttleZone(e.target.value)}
                      placeholder="Zona A / Zona B"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowStudentModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingStudent}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {savingStudent ? 'Menyimpan...' : 'Simpan Data Siswa'}
                </button>
              </div>
            </form>
          </div>
        </div>,
          document.body,
        )}

      {/* Modal Konfirmasi Hapus Siswa & Tagihan Aktif */}
      {deleteStudentTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget && !deletingStudent) setDeleteStudentTarget(null);
            }}
          >
            <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-md overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
              <div className="h-1.5 w-full bg-red-600" />
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-display text-base font-bold text-slate-900">
                      Hapus Data Siswa?
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Anda akan menghapus siswa{' '}
                      <span className="font-semibold text-slate-900">{deleteStudentTarget.name}</span>{' '}
                      (NIS <span className="font-mono">{deleteStudentTarget.nis}</span>).
                    </p>
                  </div>
                </div>
                {(() => {
                  const unpaidCount = invoices.filter(
                    (i) => i.studentId === deleteStudentTarget.id && i.status !== 'paid',
                  ).length;
                  return (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 leading-relaxed">
                      {unpaidCount > 0
                        ? `Terdapat ${unpaidCount} tagihan yang belum lunas milik siswa ini yang juga akan ikut terhapus otomatis agar tidak menjadi tagihan yatim. Riwayat kuitansi yang sudah Lunas tetap disimpan sebagai arsip akuntansi.`
                        : 'Siswa ini tidak memiliki tagihan belum lunas. Riwayat kuitansi yang sudah Lunas (jika ada) tetap tersimpan.'}
                    </div>
                  );
                })()}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={deletingStudent}
                    onClick={() => setDeleteStudentTarget(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={deletingStudent}
                    onClick={() => void confirmDeleteStudent()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50"
                  >
                    {deletingStudent ? 'Menghapus...' : 'Ya, Hapus Siswa & Tagihan Aktif'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Edit Tagihan Unpaid */}
      {editingInvoice &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditingInvoice(null);
            }}
          >
            <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-md max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
              <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">Edit Tagihan</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {editingInvoice.studentName} · {editingInvoice.studentNis}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form
                onSubmit={handleSaveInvoiceEdit}
                className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain"
              >
                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                    {errorMsg}
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Judul Tagihan</label>
                  <input
                    type="text"
                    required
                    value={editInvTitle}
                    onChange={(e) => setEditInvTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Periode</label>
                    <input
                      type="text"
                      required
                      value={editInvPeriod}
                      onChange={(e) => setEditInvPeriod(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Jatuh Tempo</label>
                    <input
                      type="date"
                      required
                      value={editInvDueDate}
                      onChange={(e) => setEditInvDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nominal Tagihan Total (Rp)
                  </label>
                  <input
                    type="number"
                    required
                    min={Math.max(1000, getInvoicePaidAmount(editingInvoice) + 1)}
                    value={editInvAmount}
                    onChange={(e) => setEditInvAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                  {getInvoicePaidAmount(editingInvoice) > 0 && (
                    <p className="text-[11px] text-[#2563EB] mt-1">
                      Sudah dicicil sebesar {formatRupiah(getInvoicePaidAmount(editingInvoice))}.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Catatan (Opsional)</label>
                  <input
                    type="text"
                    value={editInvNotes}
                    onChange={(e) => setEditInvNotes(e.target.value)}
                    placeholder="Keterangan koreksi / potongan subsidi"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setEditingInvoice(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={savingInvoiceEdit}
                    className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                  >
                    {savingInvoiceEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Import Siswa Massal (Excel / CSV) */}
      {showImportModal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget && !importingStudents) setShowImportModal(false);
            }}
          >
            <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-3xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
              <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Import Data Siswa Massal (Excel / CSV)
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Unduh template Excel, lengkapi data siswa beserta email Google wali murid, lalu unggah kembali.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                    {errorMsg}
                  </div>
                )}
                {importFileError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                    {importFileError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-slate-900">1. Siapkan Format Kolom Excel</p>
                    <p className="text-[11px] text-slate-500">
                      Gunakan template agar kolom NIS, Nama, Jenjang, Kelas, Email Wali, dan No WA sesuai.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={downloadStudentExcelTemplate}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-white border border-blue-200 rounded-xl hover:bg-[#EEF4FF] shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Template (.xlsx)
                  </button>
                </div>

                <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-300 rounded-2xl text-center hover:bg-slate-50 cursor-pointer">
                  <FileSpreadsheet className="w-7 h-7 text-[#2563EB]" />
                  <span className="text-xs font-semibold text-slate-900">
                    2. Pilih File Excel (.xlsx / .xls) atau .csv
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Sistem akan memvalidasi duplikasi NIS &amp; format email sebelum data disimpan.
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportFileChange}
                    className="hidden"
                  />
                </label>

                {importRows.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        Pratinjau Hasil Pembacaan ({importRows.length} baris)
                      </span>
                      <div className="flex items-center gap-3 font-medium">
                        <span className="text-emerald-700">
                          Valid: {importRows.filter((r) => !r.error).length}
                        </span>
                        <span className="text-red-600">
                          Dilewati/Error: {importRows.filter((r) => r.error).length}
                        </span>
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                          <tr>
                            <th className="text-left px-3 py-2">Baris</th>
                            <th className="text-left px-3 py-2">NIS</th>
                            <th className="text-left px-3 py-2">Nama Siswa</th>
                            <th className="text-left px-3 py-2">Jenjang &amp; Kelas</th>
                            <th className="text-left px-3 py-2">Email Wali</th>
                            <th className="text-left px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importRows.slice(0, 100).map((row) => (
                            <tr key={row.rowNum} className={row.error ? 'bg-red-50/50' : ''}>
                              <td className="px-3 py-2 font-mono text-slate-500">{row.rowNum}</td>
                              <td className="px-3 py-2 font-mono">{row.nis || '-'}</td>
                              <td className="px-3 py-2 font-medium text-slate-900">{row.name || '-'}</td>
                              <td className="px-3 py-2">
                                {row.level} · {row.grade}
                              </td>
                              <td className="px-3 py-2 font-mono">{row.parentEmail || '-'}</td>
                              <td className="px-3 py-2">
                                {row.error ? (
                                  <span className="text-red-700 font-semibold">{row.error}</span>
                                ) : (
                                  <span className="text-emerald-700 font-semibold">Siap Impor</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={
                    importingStudents || importRows.filter((r) => !r.error).length === 0
                  }
                  onClick={() => void handleCommitImportStudents()}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {importingStudents
                    ? 'Mengimpor...'
                    : `Import ${importRows.filter((r) => !r.error).length} Siswa Valid`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Kenaikan Kelas & Kelulusan Massal */}
      {showPromoteModal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget && !promotingStudents) setShowPromoteModal(false);
            }}
          >
            <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
              <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Kenaikan Kelas &amp; Kelulusan Massal
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Naikkan tingkat kelas siswa aktif sekaligus. Siswa tingkat akhir otomatis berstatus Lulus / Alumni.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPromoteModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
                {errorMsg && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                    {errorMsg}
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Filter Jenjang</label>
                    <select
                      value={promoteLevel}
                      onChange={(e) => {
                        setPromoteLevel(e.target.value as 'ALL' | SchoolLevel);
                        setPromoteGrade('ALL');
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                    >
                      <option value="ALL">Semua Jenjang Aktif</option>
                      {school.enabledLevels.map((lvl) => (
                        <option key={lvl} value={lvl}>
                          {lvl}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Filter Kelas</label>
                    <select
                      value={promoteGrade}
                      onChange={(e) => setPromoteGrade(e.target.value)}
                      disabled={promoteLevel === 'ALL'}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white disabled:bg-slate-50 focus:outline-none focus:border-[#2563EB]"
                    >
                      <option value="ALL">Semua Kelas</option>
                      {promoteLevel !== 'ALL' &&
                        LEVEL_GRADES[promoteLevel].map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-64 overflow-y-auto">
                  {promoteCandidates.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">
                      Tidak ada siswa aktif pada filter ini.
                    </p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2">Siswa</th>
                          <th className="text-left px-3 py-2">Kelas Sekarang</th>
                          <th className="text-left px-3 py-2">Hasil Kenaikan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {promoteCandidates.map(({ student, nextGrade, nextStatus }) => (
                          <tr key={student.id}>
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {student.name}{' '}
                              <span className="font-mono text-slate-500 font-normal">({student.nis})</span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {student.level} · {student.grade}
                            </td>
                            <td className="px-3 py-2 font-semibold">
                              {nextStatus === 'graduated' ? (
                                <span className="text-amber-700">Lulus / Alumni ({nextGrade})</span>
                              ) : (
                                <span className="text-emerald-700">
                                  Naik ke {student.level} · {nextGrade}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={promotingStudents}
                  onClick={() => setShowPromoteModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={promotingStudents || promoteCandidates.length === 0}
                  onClick={() => void handleExecutePromote()}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  {promotingStudents
                    ? 'Memproses...'
                    : `Proses ${promoteCandidates.length} Siswa`}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Preview Foto Bukti Transfer */}
      {previewProofTx &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPreviewProofTx(null);
            }}
          >
            <div className="m-auto bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-panel-enter">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Foto Bukti Transfer · {previewProofTx.studentName}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {formatRupiah(previewProofTx.totalAmount)} · Pengirim: {previewProofTx.transferSenderName || '-'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewProofTx(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 bg-slate-100 flex items-center justify-center">
                {previewProofTx.transferProofDataUrl && (
                  <img
                    src={previewProofTx.transferProofDataUrl}
                    alt={`Bukti transfer ${previewProofTx.studentName}`}
                    className="max-h-[70dvh] w-auto rounded-xl border border-slate-200 bg-white"
                  />
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Modal Salin Pesan WhatsApp (jika No. WA Siswa Belum Diisi) */}
      {waFallbackModal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setWaFallbackModal(null);
            }}
          >
            <div className="m-auto bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-panel-enter">
              <div className="h-1.5 w-full bg-emerald-600" />
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    {waFallbackModal.title}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Nomor HP/WA wali murid untuk {waFallbackModal.studentName} belum diisi. Salin pesan di bawah atau isi No. HP pada Data Siswa untuk kirim 1-klik.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setWaFallbackModal(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <textarea
                  readOnly
                  rows={10}
                  value={waFallbackModal.message}
                  className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setWaFallbackModal(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                  >
                    Tutup
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(waFallbackModal.message);
                      setCopiedWaMsg(true);
                      setTimeout(() => setCopiedWaMsg(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700"
                  >
                    {copiedWaMsg ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedWaMsg ? 'Pesan Tersalin' : 'Salin Pesan Pengingat'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {counterCheckoutInvoices && (
        <CheckoutModal
          invoices={counterCheckoutInvoices}
          schoolCode={school.code}
          school={school}
          userUid={userUid}
          userEmail={userEmail}
          onClose={() => setCounterCheckoutInvoices(null)}
          onSettled={(tx) => {
            setCashierInvoiceIds([]);
            setToastMsg(`Pembayaran ${tx.receiptNumber} selesai.`);
          }}
        />
      )}

      {receiptTx && (
        <ReceiptModal
          transaction={receiptTx}
          school={school}
          onClose={() => setReceiptTx(null)}
        />
      )}
    </AppShell>
  );
};
