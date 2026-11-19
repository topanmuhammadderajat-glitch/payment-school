import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardList,
  Copy,
  Database,
  Edit3,
  Globe,
  Layers,
  Plus,
  Receipt,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ALL_SCHOOL_LEVELS,
  EnabledModules,
  Invoice,
  School,
  SchoolLevel,
  SchoolRequest,
  Student,
  Transaction,
} from '../types';
import {
  ACTIVE_METHOD_LABELS,
  CATEGORY_LABELS,
  INDONESIAN_BANKS,
  formatDateTimeId,
  formatRupiah,
  generateSafeId,
  getInvoicePaidAmount,
  getInvoiceRemainingAmount,
  normalizeEmail,
} from '../utils/formatters';
import { seedSampleMultiSchoolData } from '../utils/seedData';
import { ReceiptModal } from './ReceiptModal';
import {
  AppShell,
  CircularProgressRing,
  PortalShellContext,
  ShellNavItem,
  ShellSecondaryItem,
} from './AppShell';

interface SuperAdminPortalProps {
  shell: PortalShellContext;
  userUid: string;
  userEmail: string;
  schools: School[];
  schoolRequests: SchoolRequest[];
  students: Student[];
  invoices: Invoice[];
  transactions: Transaction[];
  onOpenSchoolPortal: (schoolId: string) => void;
}

type AdminTab = 'overview' | 'schools' | 'requests' | 'transactions';

export const SuperAdminPortal: React.FC<SuperAdminPortalProps> = ({
  shell,
  userUid,
  userEmail,
  schools,
  schoolRequests,
  students,
  invoices,
  transactions,
  onOpenSchoolPortal,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [schoolFilterId, setSchoolFilterId] = useState<string>('all');
  const [seeding, setSeeding] = useState(false);
  const [showSchoolModal, setShowSchoolModal] = useState(false);
  const [editingSchool, setEditingSchool] = useState<School | null>(null);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [processingReqId, setProcessingReqId] = useState('');
  const [copiedDomainHost, setCopiedDomainHost] = useState(false);

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';

  useEffect(() => {
    if (!showSchoolModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSchoolModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showSchoolModal]);

  const reportActionError = (err: unknown, op: OperationType, path: string) => {
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      setErrorMsg(
        wrapped instanceof Error ? wrapped.message : 'Terjadi kendala saat menyimpan data.',
      );
    }
  };

  // School Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [npsn, setNpsn] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [principalName, setPrincipalName] = useState('');
  const [treasurerName, setTreasurerName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [enabledLevels, setEnabledLevels] = useState<SchoolLevel[]>(['SD']);
  const [enabledModules, setEnabledModules] = useState<EnabledModules>({
    spp: true,
    daftarUlang: true,
    jemputan: false,
  });
  const [adminEmailsText, setAdminEmailsText] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [savingSchool, setSavingSchool] = useState(false);

  const openCreateSchool = () => {
    setErrorMsg('');
    setEditingSchool(null);
    setName('');
    setCode('');
    setNpsn('');
    setCity('');
    setAddress('');
    setPhone('');
    setPrincipalName('');
    setTreasurerName('');
    setBankName('');
    setBankAccountNumber('');
    setBankAccountHolder('');
    setEnabledLevels(['SD']);
    setEnabledModules({ spp: true, daftarUlang: true, jemputan: false });
    setAdminEmailsText(userEmail);
    setStatus('active');
    setShowSchoolModal(true);
  };

  const openEditSchool = (sch: School) => {
    setErrorMsg('');
    setEditingSchool(sch);
    setName(sch.name);
    setCode(sch.code);
    setNpsn(sch.npsn || '');
    setCity(sch.city || '');
    setAddress(sch.address || '');
    setPhone(sch.phone || '');
    setPrincipalName(sch.principalName || '');
    setTreasurerName(sch.treasurerName || '');
    setBankName(sch.bankName || '');
    setBankAccountNumber(sch.bankAccountNumber || '');
    setBankAccountHolder(sch.bankAccountHolder || '');
    setEnabledLevels(sch.enabledLevels);
    setEnabledModules(sch.enabledModules);
    setAdminEmailsText(sch.adminEmails.join('\n'));
    setStatus(sch.status);
    setShowSchoolModal(true);
  };

  const toggleLevel = (lvl: SchoolLevel) => {
    setEnabledLevels((prev) =>
      prev.includes(lvl)
        ? prev.length > 1
          ? prev.filter((l) => l !== lvl)
          : prev
        : [...prev, lvl],
    );
  };

  const syncSchoolAccessAcrossCollections = async (
    schoolId: string,
    newEmails: string[],
    newSchoolName: string,
    emailsChanged: boolean,
    nameChanged: boolean,
    bankChanged: boolean,
    bankFields: {
      bankName: string;
      bankAccountNumber: string;
      bankAccountHolder: string;
    },
  ) => {
    if (!emailsChanged && !nameChanged && !bankChanged) return;
    const targets: Array<{ col: string; hasSchoolName: boolean }> = [
      { col: 'feeTemplates', hasSchoolName: false },
      { col: 'students', hasSchoolName: true },
      { col: 'invoices', hasSchoolName: true },
      { col: 'transactions', hasSchoolName: true },
    ];

    const updates: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    for (const target of targets) {
      const snap = await getDocs(
        query(collection(db, target.col), where('schoolId', '==', schoolId)),
      );
      snap.forEach((d) => {
        const docData = d.data() as { status?: string };
        const patch: Record<string, unknown> = { updatedAt: serverTimestamp() };
        let hasChange = false;
        if (emailsChanged) {
          patch.authorizedFinanceEmails = newEmails;
          hasChange = true;
        }
        if (nameChanged && target.hasSchoolName) {
          patch.schoolName = newSchoolName;
          hasChange = true;
        }
        if (bankChanged && target.col === 'invoices' && docData.status !== 'paid') {
          patch.schoolBankName = bankFields.bankName;
          patch.schoolBankAccountNumber = bankFields.bankAccountNumber;
          patch.schoolBankAccountHolder = bankFields.bankAccountHolder;
          hasChange = true;
        }
        if (hasChange) {
          updates.push({ ref: doc(db, target.col, d.id), data: patch });
        }
      });
    }

    for (let i = 0; i < updates.length; i += 400) {
      const chunk = updates.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((item) => batch.update(item.ref, item.data));
      await batch.commit();
    }
  };

  const handleSaveSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanName = name.trim().slice(0, 120);
    const cleanCode = code.trim().toUpperCase().slice(0, 24);
    if (cleanName.length < 2 || cleanCode.length < 2) {
      setErrorMsg('Nama sekolah dan kode sekolah minimal 2 karakter.');
      return;
    }

    const parsedEmails = Array.from(
      new Set(
        adminEmailsText
          .split(/[\n,;]+/)
          .map((em) => normalizeEmail(em).slice(0, 120))
          .filter((em) => em.includes('@') && em.length >= 3),
      ),
    ).slice(0, 10);

    if (parsedEmails.length === 0) {
      parsedEmails.push(normalizeEmail(userEmail).slice(0, 120));
    }

    setSavingSchool(true);
    try {
      const schoolId = editingSchool?.id || generateSafeId('sch');
      const cleanNpsn = npsn.trim().slice(0, 20);
      const cleanCity = city.trim().slice(0, 80);
      const cleanAddress = address.trim().slice(0, 250);
      const cleanPhone = phone.trim().slice(0, 30);
      const cleanPrincipal = principalName.trim().slice(0, 100);
      const cleanTreasurer = treasurerName.trim().slice(0, 100);
      const cleanBankName = bankName.trim().slice(0, 60);
      const cleanBankAccNum = bankAccountNumber.trim().slice(0, 40);
      const cleanBankAccHolder = bankAccountHolder.trim().slice(0, 120);

      if (editingSchool) {
        const emailsChanged =
          JSON.stringify(editingSchool.adminEmails) !== JSON.stringify(parsedEmails);
        const nameChanged = editingSchool.name !== cleanName;
        const bankChanged =
          (editingSchool.bankName || '') !== cleanBankName ||
          (editingSchool.bankAccountNumber || '') !== cleanBankAccNum ||
          (editingSchool.bankAccountHolder || '') !== cleanBankAccHolder;

        await updateDoc(doc(db, 'schools', schoolId), {
          name: cleanName,
          code: cleanCode,
          npsn: cleanNpsn,
          city: cleanCity,
          address: cleanAddress,
          phone: cleanPhone,
          principalName: cleanPrincipal,
          treasurerName: cleanTreasurer,
          bankName: cleanBankName,
          bankAccountNumber: cleanBankAccNum,
          bankAccountHolder: cleanBankAccHolder,
          enabledLevels,
          enabledModules,
          adminEmails: parsedEmails,
          status,
          updatedAt: serverTimestamp(),
        });

        await syncSchoolAccessAcrossCollections(
          schoolId,
          parsedEmails,
          cleanName,
          emailsChanged,
          nameChanged,
          bankChanged,
          {
            bankName: cleanBankName,
            bankAccountNumber: cleanBankAccNum,
            bankAccountHolder: cleanBankAccHolder,
          },
        );
        setToastMsg(`Data sekolah "${cleanName}" berhasil diperbarui.`);
      } else {
        await setDoc(doc(db, 'schools', schoolId), {
          id: schoolId,
          name: cleanName,
          code: cleanCode,
          npsn: cleanNpsn,
          city: cleanCity,
          address: cleanAddress,
          phone: cleanPhone,
          principalName: cleanPrincipal,
          treasurerName: cleanTreasurer,
          bankName: cleanBankName,
          bankAccountNumber: cleanBankAccNum,
          bankAccountHolder: cleanBankAccHolder,
          enabledLevels,
          enabledModules,
          adminEmails: parsedEmails,
          status,
          createdBy: userUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        setToastMsg(`Sekolah baru "${cleanName}" berhasil ditambahkan.`);
      }
      setShowSchoolModal(false);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, 'schools');
    } finally {
      setSavingSchool(false);
    }
  };

  const handleSeedSamples = async () => {
    setErrorMsg('');
    setSeeding(true);
    try {
      await seedSampleMultiSchoolData(userUid, userEmail);
      setToastMsg('3 sekolah contoh (SD saja, SD+SMP, dan TK-SMA lengkap) beserta data tarif & transaksi berhasil dimuat.');
    } catch (err) {
      reportActionError(err, OperationType.WRITE, 'seedSampleMultiSchoolData');
    } finally {
      setSeeding(false);
    }
  };

  const handleApproveRequest = async (req: SchoolRequest) => {
    if (processingReqId) return;
    setErrorMsg('');
    setProcessingReqId(req.id);
    const newSchoolId = generateSafeId('sch');
    const codeSuggestion =
      req.schoolName
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .map((w) => w[0] || '')
        .join('')
        .toUpperCase()
        .slice(0, 6) || 'SCH';
    const safeCode = codeSuggestion.length >= 2 ? codeSuggestion : `${codeSuggestion}01`;

    const batch = writeBatch(db);
    batch.update(doc(db, 'schoolRequests', req.id), {
      status: 'approved',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'schools', newSchoolId), {
      id: newSchoolId,
      name: req.schoolName.trim().slice(0, 120),
      code: safeCode.slice(0, 24),
      npsn: '',
      city: req.city.trim().slice(0, 80),
      address: '',
      phone: (req.contactPhone || '').trim().slice(0, 30),
      principalName: '',
      treasurerName: '',
      bankName: (req.bankName || '').trim().slice(0, 60),
      bankAccountNumber: (req.bankAccountNumber || '').trim().slice(0, 40),
      bankAccountHolder: (req.bankAccountHolder || '').trim().slice(0, 120),
      status: 'active',
      enabledLevels: req.requestedLevels,
      enabledModules: req.requestedModules,
      adminEmails: [normalizeEmail(req.contactEmail).slice(0, 120)],
      createdBy: userUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      setToastMsg(`Permohonan "${req.schoolName}" disetujui dan portal sekolah langsung aktif.`);
    } catch (err) {
      reportActionError(err, OperationType.WRITE, `schoolRequests/${req.id}`);
    } finally {
      setProcessingReqId('');
    }
  };

  const handleRejectRequest = async (req: SchoolRequest) => {
    if (processingReqId) return;
    setErrorMsg('');
    setProcessingReqId(req.id);
    try {
      await updateDoc(doc(db, 'schoolRequests', req.id), {
        status: 'rejected',
        updatedAt: serverTimestamp(),
      });
      setToastMsg(`Permohonan "${req.schoolName}" ditolak.`);
    } catch (err) {
      reportActionError(err, OperationType.UPDATE, `schoolRequests/${req.id}`);
    } finally {
      setProcessingReqId('');
    }
  };

  const metrics = useMemo(() => {
    const settled = transactions.filter((t) => t.status === 'settled');
    const totalRevenue = settled.reduce((s, t) => s + t.totalAmount, 0);
    const totalUnpaid = invoices
      .filter((i) => i.status !== 'paid')
      .reduce((s, i) => s + getInvoiceRemainingAmount(i), 0);

    const byMethod = { cash: 0, bank_transfer: 0, va: 0, qris: 0 };
    settled.forEach((t) => {
      byMethod[t.method] = (byMethod[t.method] || 0) + t.totalAmount;
    });

    const byCategory = { spp: 0, daftar_ulang: 0, jemputan: 0, manual: 0 };
    invoices.forEach((i) => {
      const paidVal = getInvoicePaidAmount(i);
      if (paidVal > 0) {
        byCategory[i.category] = (byCategory[i.category] || 0) + paidVal;
      }
    });

    return {
      activeSchools: schools.filter((s) => s.status === 'active').length,
      totalStudents: students.length,
      totalRevenue,
      totalUnpaid,
      byMethod,
      byCategory,
      settledCount: settled.length,
    };
  }, [schools, students, invoices, transactions]);

  const filteredSchools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return schools.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q),
    );
  }, [schools, searchQuery]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((t) => schoolFilterId === 'all' || t.schoolId === schoolFilterId)
      .filter(
        (t) =>
          !q ||
          t.studentName.toLowerCase().includes(q) ||
          t.receiptNumber.toLowerCase().includes(q) ||
          t.schoolName.toLowerCase().includes(q),
      )
      .sort((a, b) => (b.settledAt || '').localeCompare(a.settledAt || ''));
  }, [transactions, schoolFilterId, searchQuery]);

  const pendingRequestsCount = schoolRequests.filter((r) => r.status === 'pending').length;

  const categoryTotalSum =
    metrics.byCategory.spp +
    metrics.byCategory.daftar_ulang +
    metrics.byCategory.jemputan +
    metrics.byCategory.manual;

  const platformCollectionTotal = metrics.totalRevenue + metrics.totalUnpaid;
  const platformCollectionPercent =
    platformCollectionTotal > 0
      ? Math.round((metrics.totalRevenue / platformCollectionTotal) * 100)
      : 0;

  const navItems: ShellNavItem[] = [
    { key: 'overview', label: 'Ringkasan Platform', shortLabel: 'Ringkasan', icon: Layers },
    { key: 'schools', label: 'Sekolah Mitra', shortLabel: 'Sekolah', icon: Building2, count: schools.length },
    {
      key: 'requests',
      label: 'Permohonan Baru',
      shortLabel: 'Permohonan',
      icon: ClipboardList,
      count: pendingRequestsCount,
    },
    {
      key: 'transactions',
      label: 'Transaksi Global',
      shortLabel: 'Transaksi',
      icon: Receipt,
      count: transactions.length,
    },
  ];

  const SCHOOL_DOTS = ['bg-blue-500', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-indigo-500'];
  const secondarySchoolItems: ShellSecondaryItem[] = schools.map((sch, idx) => ({
    id: sch.id,
    label: sch.name,
    meta: students.filter((s) => s.schoolId === sch.id).length,
    dotColorClass: SCHOOL_DOTS[idx % SCHOOL_DOTS.length],
    onClick: () => onOpenSchoolPortal(sch.id),
  }));

  return (
    <AppShell
      shell={shell}
      navItems={navItems}
      activeNavKey={activeTab}
      onSelectNav={(key) => setActiveTab(key as AdminTab)}
      mobilePrimaryNavKeys={['overview', 'schools', 'transactions']}
      onMobilePrimaryAction={openCreateSchool}
      mobilePrimaryActionLabel="Tambah Sekolah Mitra"
      secondarySectionTitle="Sekolah Mitra"
      secondarySectionAction={{ label: 'Tambah Sekolah Mitra', onClick: openCreateSchool }}
      secondaryItems={secondarySchoolItems}
      progressWidget={{
        title: 'Total Penerimaan Lunas',
        rightText: `${platformCollectionPercent}%`,
        percent: platformCollectionPercent,
      }}
      topSearchValue={searchQuery}
      topSearchPlaceholder="Cari nama sekolah, kode, kota..."
      onTopSearchChange={setSearchQuery}
    >
      <div className="space-y-6 animate-panel-enter">
        {toastMsg && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs font-medium text-emerald-800 flex items-center justify-between gap-4">
            <span>{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg('')}
              className="text-emerald-700 hover:text-emerald-900 font-semibold shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {errorMsg && !showSchoolModal && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-medium text-red-700 flex items-center justify-between gap-4">
            <span className="break-all">{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg('')}
              className="text-red-800 hover:text-red-950 font-semibold shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Airy Page Header (Matches Reference Header Layout) */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">Konsol Pemilik Platform</p>
            <h1 className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-slate-900 leading-tight">
              Manajemen Multi-Sekolah &amp; Transaksi Global
            </h1>
            <p className="text-xs text-slate-500">
              <strong className="text-slate-900 font-semibold">{metrics.activeSchools}</strong> sekolah aktif ·{' '}
              <strong className="text-slate-900 font-semibold">{metrics.totalStudents}</strong> siswa terdaftar ·{' '}
              <strong className="text-emerald-600 font-semibold">{metrics.settledCount}</strong> transaksi selesai
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {schools.length === 0 && (
              <button
                type="button"
                disabled={seeding}
                onClick={handleSeedSamples}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200/90 rounded-xl hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Database className="w-3.5 h-3.5 text-[#2563EB]" />
                {seeding ? 'Memuat Data Contoh...' : 'Muat 3 Sekolah Contoh'}
              </button>
            )}
            <button
              type="button"
              onClick={openCreateSchool}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0 shadow-[0_4px_12px_rgba(37,99,235,0.28)]"
            >
              <Plus className="w-4 h-4" />
              Tambah Sekolah Mitra
            </button>
          </div>
        </div>

        {/* Clean Segmented Sub-Tab Bar */}
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit overflow-x-auto max-w-full no-scrollbar">
          {(
            [
              ['overview', 'Ringkasan Platform'],
              ['schools', `Sekolah Mitra (${schools.length})`],
              ['requests', `Permohonan Baru (${pendingRequestsCount})`],
              ['transactions', `Transaksi Global (${transactions.length})`],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tabKey
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="grid xl:grid-cols-12 gap-6 items-start">
            {/* Left Primary Column */}
            <div className="xl:col-span-8 space-y-6 min-w-0">
              {/* Deep Royal Navy-Blue Hero Card (Matches Reference Focus Card) */}
              <div className="bg-gradient-to-br from-[#132652] via-[#1B3C7C] to-[#244FA3] text-white rounded-[20px] p-6 sm:p-7 shadow-[0_12px_28px_rgba(20,39,84,0.18)] space-y-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-blue-200">Total Penerimaan Lunas</p>
                    <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
                      {formatRupiah(metrics.totalRevenue)}
                    </p>
                    <p className="text-xs text-blue-100/85">
                      {metrics.activeSchools} sekolah aktif · {metrics.totalStudents} siswa terdaftar · {metrics.settledCount} transaksi selesai
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[11px] font-semibold text-white whitespace-nowrap shrink-0">
                    {platformCollectionPercent}% Tertagih
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={openCreateSchool}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-900 bg-white rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <Plus className="w-4 h-4 text-[#2563EB]" />
                    Tambah Sekolah Mitra
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('schools')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/12 border border-white/20 rounded-xl hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
                  >
                    Sekolah Mitra ({schools.length})
                  </button>
                </div>
              </div>

              {/* 4 Compact White KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <p className="text-xs font-medium text-slate-500">Sekolah Aktif</p>
                  <p className="text-xl sm:text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1.5">
                    {metrics.activeSchools}{' '}
                    <span className="text-xs font-normal text-slate-400">/ {schools.length}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Institusi tergabung</p>
                </div>
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <p className="text-xs font-medium text-slate-500">Total Siswa Terdaftar</p>
                  <p className="text-xl sm:text-2xl font-mono font-bold text-slate-900 tabular-nums mt-1.5">
                    {metrics.totalStudents}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Lintas TK, SD, SMP &amp; SMA</p>
                </div>
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <p className="text-xs font-medium text-slate-500">Total Penerimaan Lunas</p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-[#2563EB] tabular-nums mt-1.5 break-all">
                    {formatRupiah(metrics.totalRevenue)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {metrics.settledCount} transaksi selesai
                  </p>
                </div>
                <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <p className="text-xs font-medium text-slate-500">Piutang Tagihan Berjalan</p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-slate-900 tabular-nums mt-1.5 break-all">
                    {formatRupiah(metrics.totalUnpaid)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">Belum lunas lintas sekolah</p>
                </div>
              </div>

              {/* Checklist Verifikasi Domain Login Google (Shared URL) */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-xl bg-[#EEF4FF] border border-blue-100 flex items-center justify-center text-[#2563EB] shrink-0 mt-0.5">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-900">
                      Verifikasi Domain Login Google (Saat Aplikasi Dibagikan / Shared URL)
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                      Jika sekolah atau wali murid membuka aplikasi lewat Shared App URL (
                      <span className="font-mono text-slate-800">ais-pre-...</span>), pastikan hostname tersebut sudah masuk daftar{' '}
                      <strong>Firebase Console → Authentication → Settings → Authorized domains</strong> (Project{' '}
                      <span className="font-mono font-semibold text-slate-800">top-sled-zxq1s</span>) agar tombol Masuk Google tidak ditolak (
                      <span className="font-mono">auth/unauthorized-domain</span>).
                    </p>
                  </div>
                </div>
                {currentHostname && (
                  <div className="flex items-center gap-2 bg-[#F8FAFD] border border-slate-200 rounded-xl px-3 py-2 shrink-0">
                    <span className="font-mono text-[11px] text-slate-800 max-w-[200px] truncate">
                      {currentHostname}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(currentHostname);
                        setCopiedDomainHost(true);
                        setTimeout(() => setCopiedDomainHost(false), 1800);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#2563EB] bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap"
                    >
                      {copiedDomainHost ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedDomainHost ? 'Tersalin' : 'Salin Host'}
                    </button>
                  </div>
                )}
              </div>

              {/* Quick School Cards */}
              <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Akses Cepat Sekolah Mitra
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Pilih sekolah untuk melihat atau mengelola langsung portal Bagian Keuangan sekolah tersebut.
                    </p>
                  </div>
                  {schools.length > 0 && (
                    <button
                      type="button"
                      disabled={seeding}
                      onClick={handleSeedSamples}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-[#F8FAFD] border border-slate-200 rounded-xl hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#2563EB]" />
                      {seeding ? 'Memuat...' : 'Sinkronkan Data Contoh'}
                    </button>
                  )}
                </div>

                {schools.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <Building2 className="w-7 h-7 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-900">
                      Belum ada sekolah terdaftar
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Tambahkan sekolah pertama secara manual atau muat 3 sekolah contoh untuk langsung menguji konfigurasi fleksibel (SD saja, SD+SMP, TK–SMA).
                    </p>
                    <div className="flex items-center justify-center gap-3 pt-2">
                      <button
                        type="button"
                        disabled={seeding}
                        onClick={handleSeedSamples}
                        className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
                      >
                        Muat 3 Sekolah Contoh
                      </button>
                      <button
                        type="button"
                        onClick={openCreateSchool}
                        className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                      >
                        Tambah Manual
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {schools.map((sch) => {
                      const activeMods = [
                        sch.enabledModules.spp && 'SPP',
                        sch.enabledModules.daftarUlang && 'Daftar Ulang',
                        sch.enabledModules.jemputan && 'Jemputan',
                        'Manual',
                      ]
                        .filter(Boolean)
                        .join(' · ');
                      const schoolStuCount = students.filter((s) => s.schoolId === sch.id).length;

                      return (
                        <div
                          key={sch.id}
                          className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F8FAFD] transition-colors"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-[#EEF4FF] border border-blue-100 text-[#2563EB] font-display font-bold text-xs flex items-center justify-center shrink-0">
                              {sch.code.slice(0, 3)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 text-sm truncate">
                                  {sch.name}
                                </span>
                                <span className="font-mono text-xs text-slate-400">{sch.code}</span>
                                <span
                                  className={`text-xs font-semibold ${
                                    sch.status === 'active' ? 'text-emerald-600' : 'text-slate-500'
                                  }`}
                                >
                                  {sch.status === 'active' ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5 truncate">
                                Jenjang: {sch.enabledLevels.join(', ')} · Layanan: {activeMods} ·{' '}
                                {schoolStuCount} siswa
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditSchool(sch)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Konfigurasi
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenSchoolPortal(sch.id)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
                            >
                              Buka Keuangan
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Rail Analytics (Matches Reference Circular Ring & Project Progress List) */}
            <div className="xl:col-span-4 space-y-5">
              {/* Circular Collectibility Ring Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
                <div className="flex items-center gap-4">
                  <CircularProgressRing percent={platformCollectionPercent} size={64} strokeWidth={6} />
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-slate-900">
                      Total Penerimaan Lunas
                    </p>
                    <p className="font-mono text-sm font-bold text-[#2563EB] tabular-nums mt-0.5 truncate">
                      {formatRupiah(metrics.totalRevenue)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {metrics.settledCount} transaksi selesai
                    </p>
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Piutang Tagihan Berjalan</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatRupiah(metrics.totalUnpaid)}
                  </span>
                </div>
              </div>

              {/* Penerimaan per Kategori Layanan */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Penerimaan per Kategori Layanan
                </h2>
                <div className="space-y-3.5 text-xs">
                  {(
                    [
                      ['spp', 'SPP Bulanan', 'bg-[#2563EB]', 'bg-blue-500'],
                      ['daftar_ulang', 'Daftar Ulang', 'bg-sky-500', 'bg-sky-500'],
                      ['jemputan', 'Jemputan', 'bg-amber-500', 'bg-amber-500'],
                      ['manual', 'Tagihan Manual', 'bg-emerald-500', 'bg-emerald-500'],
                    ] as const
                  ).map(([key, label, barColor, dotColor]) => {
                    const val = metrics.byCategory[key];
                    const pct =
                      categoryTotalSum > 0 ? Math.round((val / categoryTotalSum) * 100) : 0;
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-slate-700 font-medium">
                            <span className={`w-2 h-2 rounded-[3px] ${dotColor} shrink-0`} />
                            {label}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatRupiah(val)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full transition-all duration-300`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Penerimaan per Kanal Pembayaran */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Penerimaan per Kanal Pembayaran
                </h2>
                <div className="space-y-3.5 text-xs">
                  {(
                    [
                      ['cash', 'Kasir Tunai', 'bg-[#1B3C7C]', 'bg-[#1B3C7C]'],
                      ['bank_transfer', 'Transfer Bank (Rekening Sekolah)', 'bg-[#2563EB]', 'bg-[#2563EB]'],
                      ['va', 'Virtual Account (VA)', 'bg-sky-500', 'bg-sky-500'],
                      ['qris', 'QRIS', 'bg-emerald-500', 'bg-emerald-500'],
                    ] as const
                  ).map(([key, label, barColor, dotColor]) => {
                    const val = metrics.byMethod[key];
                    const pct =
                      metrics.totalRevenue > 0
                        ? Math.round((val / metrics.totalRevenue) * 100)
                        : 0;
                    return (
                      <div key={key} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-slate-700 font-medium truncate">
                            <span className={`w-2 h-2 rounded-[3px] ${dotColor} shrink-0`} />
                            <span className="truncate">{label}</span>
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums shrink-0">
                            {formatRupiah(val)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor} rounded-full transition-all duration-300`}
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
        )}

        {activeTab === 'schools' && (
          <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="font-display text-base font-bold text-slate-900">
                Daftar Sekolah Mitra
              </h2>
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama sekolah, kode, kota..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Sekolah</th>
                  <th className="text-left font-medium px-4 py-3">Jenjang Aktif</th>
                  <th className="text-left font-medium px-4 py-3">Modul Tagihan</th>
                  <th className="text-left font-medium px-4 py-3">Admin Bag. Keuangan</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSchools.map((sch) => (
                  <tr key={sch.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{sch.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {sch.code} · {sch.city || 'Indonesia'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-800">
                      {sch.enabledLevels.join(' · ')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {[
                        sch.enabledModules.spp && 'SPP',
                        sch.enabledModules.daftarUlang && 'Daftar Ulang',
                        sch.enabledModules.jemputan && 'Jemputan',
                        'Manual',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-600">
                      {sch.adminEmails.join(', ')}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">
                      <span className={sch.status === 'active' ? 'text-emerald-700' : 'text-red-600'}>
                        {sch.status === 'active' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditSchool(sch)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenSchoolPortal(sch.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8]"
                        >
                          Portal
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'requests' && (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">Permohonan Pendaftaran Sekolah</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Setujui pengajuan sekolah baru untuk langsung mengaktifkan portal keuangan mereka.
            </p>
          </div>
          {schoolRequests.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Belum ada permohonan pendaftaran sekolah baru.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {schoolRequests.map((req) => (
                <div
                  key={req.id}
                  className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-semibold text-sm text-slate-900">{req.schoolName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {req.city} · Pemohon: {req.contactEmail}
                      {req.contactPhone ? ` · ${req.contactPhone}` : ''}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Jenjang: {req.requestedLevels.join(', ')} · Modul:{' '}
                      {[
                        req.requestedModules.spp && 'SPP',
                        req.requestedModules.daftarUlang && 'Daftar Ulang',
                        req.requestedModules.jemputan && 'Jemputan',
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                    {req.bankAccountNumber && (
                      <p className="text-xs text-[#2563EB] font-medium mt-1">
                        Rekening: {req.bankName || 'Bank'} ·{' '}
                        <span className="font-mono">{req.bankAccountNumber}</span>
                        {req.bankAccountHolder ? ` a.n. ${req.bankAccountHolder}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          disabled={processingReqId === req.id}
                          onClick={() => void handleApproveRequest(req)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {processingReqId === req.id ? 'Memproses...' : 'Setujui & Aktifkan'}
                        </button>
                        <button
                          type="button"
                          disabled={processingReqId === req.id}
                          onClick={() => void handleRejectRequest(req)}
                          className="px-3.5 py-2 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 disabled:opacity-50"
                        >
                          Tolak
                        </button>
                      </>
                    ) : (
                      <span
                        className={`text-xs font-semibold ${
                          req.status === 'approved' ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {req.status === 'approved' ? 'Disetujui' : 'Ditolak'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Monitor Transaksi Lintas Sekolah</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={schoolFilterId}
                onChange={(e) => setSchoolFilterId(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
              >
                <option value="all">Semua Sekolah</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari siswa / no. kuitansi..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Tanggal</th>
                  <th className="text-left font-medium px-4 py-3">Kuitansi</th>
                  <th className="text-left font-medium px-4 py-3">Sekolah &amp; Siswa</th>
                  <th className="text-left font-medium px-4 py-3">Kategori</th>
                  <th className="text-left font-medium px-4 py-3">Metode</th>
                  <th className="text-right font-medium px-4 py-3">Nominal</th>
                  <th className="text-right font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    onClick={() => tx.status === 'settled' && setReceiptTx(tx)}
                    className="hover:bg-slate-50/70 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDateTimeId(tx.settledAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                      {tx.receiptNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{tx.studentName}</p>
                      <p className="text-xs text-slate-500">
                        {tx.schoolName} · {tx.studentLevel} {tx.studentGrade}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {Array.from(new Set(tx.categories))
                        .map((c) => CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] || c)
                        .join(', ')}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                      {ACTIVE_METHOD_LABELS[tx.method]}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatRupiah(tx.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-medium whitespace-nowrap">
                      <span
                        className={
                          tx.status === 'settled'
                            ? 'text-emerald-700'
                            : tx.status === 'pending'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                        }
                      >
                        {tx.status === 'settled'
                          ? 'Lunas'
                          : tx.status === 'pending'
                            ? 'Menunggu'
                            : 'Dibatalkan'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Sekolah */}
      {showSchoolModal &&
        createPortal(
          <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex overflow-y-auto overscroll-contain p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSchoolModal(false);
          }}
        >
          <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
            <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70 shrink-0">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  {editingSchool ? `Edit Sekolah: ${editingSchool.name}` : 'Tambah Sekolah Mitra Baru'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Konfigurasi jenjang, modul layanan, dan email bendahara sekolah
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSchoolModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors shrink-0"
                aria-label="Tutup modal sekolah"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSchool} className="p-5 sm:p-6 space-y-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-700">
                  {errorMsg}
                </div>
              )}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nama Sekolah</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: SD-SMP Harapan Bangsa"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kode Sekolah</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="PHB"
                    className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">NPSN</label>
                  <input
                    type="text"
                    value={npsn}
                    onChange={(e) => setNpsn(e.target.value)}
                    placeholder="2024xxxx"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kota / Kab.</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Bandung"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Telepon</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(022) 731-xxxx"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Alamat Lengkap (untuk Kop Laporan A4)</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Jl. Pendidikan Raya No. 14"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Kepala Sekolah (Tanda Tangan PDF)</label>
                  <input
                    type="text"
                    value={principalName}
                    onChange={(e) => setPrincipalName(e.target.value)}
                    placeholder="Nama Kepala Sekolah"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Bendahara / Bag. Keuangan</label>
                  <input
                    type="text"
                    value={treasurerName}
                    onChange={(e) => setTreasurerName(e.target.value)}
                    placeholder="Nama Bendahara"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div className="p-4 bg-[#F8FAFD] border border-slate-200/80 rounded-xl space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Rekening Bank Sekolah (Untuk Pembayaran Wali Murid)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Otomatis muncul pada halaman pembayaran wali murid (Transfer Bank Langsung) dan pencairan Midtrans.
                  </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nama Bank</label>
                    <input
                      type="text"
                      list="admin-indo-bank-options"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="BCA / Bank Mandiri / BRI"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                    <datalist id="admin-indo-bank-options">
                      {INDONESIAN_BANKS.map((bank) => (
                        <option key={bank} value={bank} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nomor Rekening Sekolah
                    </label>
                    <input
                      type="text"
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      placeholder="1234567890"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nama Rekening / Atas Nama
                    </label>
                    <input
                      type="text"
                      value={bankAccountHolder}
                      onChange={(e) => setBankAccountHolder(e.target.value)}
                      placeholder="Yayasan / Nama Sekolah"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Jenjang Sekolah Aktif (Fleksibel: pilih 1 atau gabungan)
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SCHOOL_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => toggleLevel(lvl)}
                      className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                        enabledLevels.includes(lvl)
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
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Modul Tagihan Aktif (Tagihan Manual selalu tersedia)
                </label>
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {[
                    { key: 'spp' as const, label: 'SPP Bulanan' },
                    { key: 'daftarUlang' as const, label: 'Daftar Ulang' },
                    { key: 'jemputan' as const, label: 'Jemputan' },
                  ].map((m) => (
                    <label
                      key={m.key}
                      className="flex items-center gap-2.5 px-3 py-2.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={enabledModules[m.key]}
                        onChange={(e) =>
                          setEnabledModules((prev) => ({ ...prev, [m.key]: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Email Admin Bag. Keuangan (pisahkan baris/koma)
                  </label>
                  <textarea
                    rows={2}
                    value={adminEmailsText}
                    onChange={(e) => setAdminEmailsText(e.target.value)}
                    placeholder="bendahara@sekolah.id"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Status Sekolah</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowSchoolModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingSchool}
                  className="px-5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
                >
                  {savingSchool ? 'Menyimpan...' : 'Simpan Sekolah'}
                </button>
              </div>
            </form>
          </div>
        </div>,
          document.body,
        )}

      {receiptTx && (
        <ReceiptModal
          transaction={receiptTx}
          school={schools.find((s) => s.id === receiptTx.schoolId)}
          onClose={() => setReceiptTx(null)}
        />
      )}
      </div>
    </AppShell>
  );
};
