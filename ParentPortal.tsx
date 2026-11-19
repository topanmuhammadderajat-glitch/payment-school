import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  FileText,
  Image as ImageIcon,
  Receipt,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Invoice, InvoiceStatus, Student, Transaction } from '../types';
import {
  ACTIVE_METHOD_LABELS,
  CATEGORY_LABELS,
  STATUS_LABELS,
  formatDateId,
  formatDateTimeId,
  formatPeriodLabel,
  formatRupiah,
  getInvoicePaidAmount,
  getInvoiceRemainingAmount,
} from '../utils/formatters';
import {
  cancelDigitalPayment,
  checkMidtransPaymentStatus,
  settleDigitalPayment,
} from '../utils/paymentService';
import { CheckoutModal } from './CheckoutModal';
import { ReceiptModal } from './ReceiptModal';
import { exportReceiptPdf } from '../utils/exporters';
import {
  AppShell,
  CircularProgressRing,
  PortalShellContext,
  ShellNavItem,
  ShellSecondaryItem,
} from './AppShell';

interface ParentPortalProps {
  shell: PortalShellContext;
  userUid: string;
  userEmail: string;
  userName: string;
  students: Student[];
  invoices: Invoice[];
  transactions: Transaction[];
  loading: boolean;
  isPreviewMode?: boolean;
}

const CHILD_DOT_COLORS = ['bg-blue-500', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500'];

export const ParentPortal: React.FC<ParentPortalProps> = ({
  shell,
  userUid,
  userEmail,
  userName,
  students,
  invoices,
  transactions,
  loading,
  isPreviewMode = false,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [checkoutInvoices, setCheckoutInvoices] = useState<Invoice[] | null>(null);
  const [pendingTxToResume, setPendingTxToResume] = useState<Transaction | null>(null);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [checkingTxId, setCheckingTxId] = useState('');

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter((inv) => selectedStudentId === 'all' || inv.studentId === selectedStudentId)
      .filter((inv) => statusFilter === 'all' || inv.status === statusFilter)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [invoices, selectedStudentId, statusFilter]);

  const studentInvoices = useMemo(() => {
    return invoices.filter(
      (inv) => selectedStudentId === 'all' || inv.studentId === selectedStudentId,
    );
  }, [invoices, selectedStudentId]);

  const totals = useMemo(() => {
    let unpaid = 0;
    let pending = 0;
    let paid = 0;
    studentInvoices.forEach((inv) => {
      const rem = getInvoiceRemainingAmount(inv);
      const paidVal = getInvoicePaidAmount(inv);
      if (inv.status === 'unpaid') unpaid += rem;
      else if (inv.status === 'pending_payment') pending += rem;
      paid += paidVal;
    });
    return { unpaid, pending, paid };
  }, [studentInvoices]);

  const selectedInvoices = useMemo(() => {
    return invoices.filter((inv) => selectedInvoiceIds.includes(inv.id) && inv.status === 'unpaid');
  }, [invoices, selectedInvoiceIds]);

  const selectedStudentAnchor = selectedInvoices[0]?.studentId;
  const selectedTotal = selectedInvoices.reduce(
    (s, inv) => s + getInvoiceRemainingAmount(inv),
    0,
  );

  const toggleSelectInvoice = (inv: Invoice) => {
    if (inv.status !== 'unpaid') return;
    setSelectedInvoiceIds((prev) => {
      if (prev.includes(inv.id)) {
        return prev.filter((id) => id !== inv.id);
      }
      if (selectedStudentAnchor && selectedStudentAnchor !== inv.studentId) {
        return [inv.id];
      }
      if (prev.length >= 20) {
        setToastMsg('Maksimal 20 tagihan dalam satu kali pembayaran.');
        return prev;
      }
      return [...prev, inv.id];
    });
  };

  const handleOpenPendingTx = (inv: Invoice) => {
    const tx = transactions.find((t) => t.id === inv.transactionId && t.status === 'pending');
    if (tx) {
      setPendingTxToResume(tx);
      setCheckoutInvoices([inv]);
    }
  };

  const handleOpenReceiptForInvoice = (inv: Invoice) => {
    const tx = transactions.find((t) => t.id === inv.transactionId && t.status === 'settled');
    if (tx) {
      setReceiptTx(tx);
    } else {
      const fallbackTx: Transaction = {
        id: inv.transactionId || inv.id,
        schoolId: inv.schoolId,
        schoolName: inv.schoolName,
        authorizedFinanceEmails: inv.authorizedFinanceEmails,
        studentId: inv.studentId,
        studentNis: inv.studentNis,
        studentName: inv.studentName,
        studentLevel: inv.studentLevel,
        studentGrade: inv.studentGrade,
        parentEmail: inv.parentEmail,
        parentName: inv.parentName,
        invoiceIds: [inv.id],
        invoiceTitles: [inv.title],
        categories: [inv.category],
        totalAmount: inv.amount,
        method: inv.paymentMethod === 'none' ? 'cash' : inv.paymentMethod,
        channelDetail: inv.paymentChannel || 'Pembayaran Sekolah',
        receiptNumber: inv.receiptNumber || `KWT-${inv.id.slice(-8).toUpperCase()}`,
        status: 'settled',
        payerUid: userUid,
        payerEmail: userEmail,
        settledAt: inv.paidAt,
      };
      setReceiptTx(fallbackTx);
    }
  };

  const pendingTransactions = useMemo(() => {
    return transactions
      .filter((tx) => selectedStudentId === 'all' || tx.studentId === selectedStudentId)
      .filter((tx) => tx.status === 'pending');
  }, [transactions, selectedStudentId]);

  const sortedTransactions = useMemo(() => {
    return transactions
      .filter((tx) => selectedStudentId === 'all' || tx.studentId === selectedStudentId)
      .filter((tx) => tx.status === 'settled')
      .sort((a, b) => (b.settledAt || '').localeCompare(a.settledAt || ''));
  }, [transactions, selectedStudentId]);

  const handleCheckBankStatus = async (tx: Transaction) => {
    if (!tx.gatewayOrderId) {
      const invs = invoices.filter((i) => tx.invoiceIds.includes(i.id));
      setPendingTxToResume(tx);
      setCheckoutInvoices(invs.length > 0 ? invs : []);
      return;
    }
    setCheckingTxId(tx.id);
    try {
      const res = await checkMidtransPaymentStatus(tx.gatewayOrderId);
      if (res.isSettled) {
        const settled = await settleDigitalPayment(tx, userUid, res.settlementTime);
        setReceiptTx(settled);
        setToastMsg(
          `Pembayaran ${settled.receiptNumber} sebesar ${formatRupiah(settled.totalAmount)} terverifikasi lunas oleh bank.`,
        );
      } else if (res.isCancelledOrExpired) {
        await cancelDigitalPayment(tx);
        setToastMsg(
          `Sesi pembayaran (${tx.channelDetail}) sudah kedaluwarsa/dibatalkan. Silakan buat kode bayar baru.`,
        );
      } else {
        setToastMsg(`Status bank: Menunggu pembayaran (${res.transactionStatus}).`);
      }
    } catch (err) {
      setToastMsg(err instanceof Error ? err.message : 'Gagal memeriksa status dari Midtrans.');
    } finally {
      setCheckingTxId('');
    }
  };

  const getInitials = (fullName: string) =>
    fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || 'SW';

  const unpaidCount = studentInvoices.filter((i) => i.status === 'unpaid').length;
  const pendingCount = studentInvoices.filter((i) => i.status === 'pending_payment').length;
  const paidCount = studentInvoices.filter((i) => i.status === 'paid').length;
  const totalBilled = totals.paid + totals.unpaid + totals.pending;
  const paidPercent = totalBilled > 0 ? Math.round((totals.paid / totalBilled) * 100) : 0;

  const navItems: ShellNavItem[] = [
    { key: 'all', label: 'Semua', shortLabel: 'Tagihan', icon: FileText, count: studentInvoices.length },
    { key: 'unpaid', label: 'Belum Bayar', shortLabel: 'Belum', icon: CreditCard, count: unpaidCount },
    { key: 'pending_payment', label: 'Menunggu', shortLabel: 'Menunggu', icon: Clock, count: pendingCount },
    { key: 'paid', label: 'Lunas', shortLabel: 'Lunas', icon: CheckCircle2, count: paidCount },
  ];

  const secondaryItems: ShellSecondaryItem[] = [
    {
      id: 'all',
      label: 'Semua Anak',
      meta: students.length,
      active: selectedStudentId === 'all',
      dotColorClass: 'bg-[#2563EB]',
      onClick: () => {
        setSelectedStudentId('all');
        setSelectedInvoiceIds([]);
      },
    },
    ...students.map((stu, idx) => ({
      id: stu.id,
      label: stu.name,
      meta: `${stu.level} ${stu.grade}`,
      active: selectedStudentId === stu.id,
      dotColorClass: CHILD_DOT_COLORS[idx % CHILD_DOT_COLORS.length],
      onClick: () => {
        setSelectedStudentId(stu.id);
        setSelectedInvoiceIds([]);
      },
    })),
  ];

  const handleQuickPayMobile = () => {
    if (selectedInvoices.length > 0) {
      setPendingTxToResume(null);
      setCheckoutInvoices(selectedInvoices);
      return;
    }
    const firstUnpaid = studentInvoices.find((i) => i.status === 'unpaid');
    if (firstUnpaid) {
      setPendingTxToResume(null);
      setCheckoutInvoices([firstUnpaid]);
    } else {
      setStatusFilter('unpaid');
    }
  };

  return (
    <AppShell
      shell={shell}
      navItems={navItems}
      activeNavKey={statusFilter}
      onSelectNav={(key) => setStatusFilter(key as 'all' | InvoiceStatus)}
      mobilePrimaryNavKeys={['all', 'unpaid', 'paid']}
      onMobilePrimaryAction={handleQuickPayMobile}
      mobilePrimaryActionLabel="Bayar Sekarang"
      secondarySectionTitle={`Siswa Terhubung (${students.length})`}
      secondaryItems={students.length > 0 ? secondaryItems : undefined}
      progressWidget={{
        title: 'Total Sudah Lunas',
        rightText: `${paidPercent}%`,
        percent: paidPercent,
      }}
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

        {/* Clean Page Header Strip */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500">
              Portal Wali Murid{isPreviewMode ? ' · Mode Pratinjau' : ''}
            </p>
            <h1 className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-slate-900 leading-tight">
              Tagihan &amp; Pembayaran Pendidikan
            </h1>
            <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                <strong className="text-slate-900 font-semibold">{unpaidCount}</strong> tagihan aktif
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-amber-600 font-semibold">{pendingCount}</strong> sesi berjalan
              </span>
              <span aria-hidden="true">·</span>
              <span>
                <strong className="text-emerald-600 font-semibold">{paidCount}</strong> tagihan selesai
              </span>
            </p>
          </div>
          {selectedInvoices.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPendingTxToResume(null);
                setCheckoutInvoices(selectedInvoices);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0 shadow-[0_4px_12px_rgba(37,99,235,0.28)]"
            >
              <CreditCard className="w-4 h-4" />
              Bayar {selectedInvoices.length} Tagihan ·{' '}
              <span className="font-mono tabular-nums">{formatRupiah(selectedTotal)}</span>
            </button>
          )}
        </div>

        {/* 2-Column Reference Dashboard Layout */}
        <div className="grid xl:grid-cols-12 gap-6 items-start">
          {/* Primary Column */}
          <div className="xl:col-span-8 space-y-6 min-w-0">
            {/* Deep Royal Navy-Blue Hero Card (Matches Reference Focus Card) */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[#132652] via-[#1B3C7C] to-[#244FA3] text-white rounded-[20px] p-6 sm:p-7 shadow-[0_12px_28px_rgba(20,39,84,0.18)] space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <p className="text-xs font-medium text-blue-200">
                    Portal Wali Murid{isPreviewMode ? ' · Mode Pratinjau' : ''}
                  </p>
                  <p className="font-mono text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
                    {formatRupiah(totals.unpaid)}
                  </p>
                  <p className="text-xs sm:text-sm text-blue-100/85 max-w-xl leading-relaxed">
                    Selamat datang, {userName}. Periksa rincian tagihan anak dan bayar melalui Transfer Bank ke Rekening Sekolah, Virtual Account, atau QRIS.
                  </p>
                </div>
                <span className="hidden sm:inline-flex items-center px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-[11px] font-semibold text-white whitespace-nowrap shrink-0">
                  Tagihan Aktif
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {selectedInvoices.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingTxToResume(null);
                      setCheckoutInvoices(selectedInvoices);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-900 bg-white rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0 shadow-xs"
                  >
                    <CreditCard className="w-4 h-4 text-[#2563EB]" />
                    Bayar {selectedInvoices.length} Tagihan ·{' '}
                    <span className="font-mono tabular-nums">{formatRupiah(selectedTotal)}</span>
                  </button>
                ) : (
                  unpaidCount > 0 && (
                    <button
                      type="button"
                      onClick={handleQuickPayMobile}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-900 bg-white rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap shrink-0 shadow-xs"
                    >
                      <CreditCard className="w-4 h-4 text-[#2563EB]" />
                      Bayar Sekarang
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setStatusFilter('unpaid')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-white/12 border border-white/20 rounded-xl hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
                >
                  Belum Bayar ({unpaidCount})
                </button>
              </div>
            </div>

            {/* Daftar Anak Terhubung */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-700">
                  Siswa Terhubung ({students.length})
                </h2>
              </div>

              {loading ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-20 bg-white border border-slate-200/80 rounded-2xl animate-pulse"
                    />
                  ))}
                </div>
              ) : students.length === 0 ? (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center space-y-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                  <div className="w-10 h-10 rounded-xl bg-[#EEF4FF] text-[#2563EB] flex items-center justify-center mx-auto">
                    <Users className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    Belum ada data siswa yang ditautkan ke email {userEmail}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Hubungi Bagian Keuangan sekolah untuk mendaftarkan email Google Anda sebagai wali murid siswa terkait.
                  </p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudentId('all');
                      setSelectedInvoiceIds([]);
                    }}
                    className={`px-4 py-2.5 rounded-2xl border text-left transition-colors ${
                      selectedStudentId === 'all'
                        ? 'border-[#2563EB] bg-[#EEF4FF] text-[#2563EB]'
                        : 'border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <p className="text-xs font-bold">Semua Anak</p>
                    <p
                      className={`text-[11px] mt-0.5 ${
                        selectedStudentId === 'all' ? 'text-blue-600/80' : 'text-slate-500'
                      }`}
                    >
                      {students.length} siswa aktif
                    </p>
                  </button>
                  {students.map((stu) => {
                    const active = selectedStudentId === stu.id;
                    return (
                      <button
                        key={stu.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudentId(stu.id);
                          setSelectedInvoiceIds([]);
                        }}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl border text-left transition-colors ${
                          active
                            ? 'border-[#2563EB] bg-[#EEF4FF] text-[#2563EB]'
                            : 'border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-xl text-xs font-display font-bold flex items-center justify-center shrink-0 ${
                            active ? 'bg-[#2563EB] text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {getInitials(stu.name)}
                        </span>
                        <div>
                          <p className="text-xs font-bold">{stu.name}</p>
                          <p
                            className={`text-[11px] mt-0.5 ${
                              active ? 'text-blue-600/80' : 'text-slate-500'
                            }`}
                          >
                            {stu.schoolName} · {stu.level} {stu.grade}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sesi Pembayaran Menunggu Transfer / Verifikasi / Scan */}
            {pendingTransactions.length > 0 && (
              <div className="bg-amber-50/75 border border-amber-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center gap-2 text-amber-950 font-semibold text-sm">
                  <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Sesi Pembayaran &amp; Verifikasi Berjalan ({pendingTransactions.length})</span>
                </div>
                <div className="space-y-2.5">
                  {pendingTransactions.map((tx) => {
                    const relatedInvs = invoices.filter((i) => tx.invoiceIds.includes(i.id));
                    return (
                      <div
                        key={tx.id}
                        className="bg-white border border-amber-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {tx.studentName} ·{' '}
                            <span className="font-mono">{formatRupiah(tx.totalAmount)}</span>
                          </p>
                          <p className="text-xs text-slate-600 mt-0.5">
                            {tx.channelDetail}
                            {tx.method === 'bank_transfer'
                              ? `${tx.bankAccountNumber ? ` · Rek ${tx.bankAccountNumber}` : ''}${tx.transferSenderName ? ` · Pengirim: ${tx.transferSenderName}` : ''}${tx.transferReference ? ` · Ref: ${tx.transferReference}` : ''} · Menunggu verifikasi bendahara`
                              : `${tx.vaBillerCode ? ` · Biller ${tx.vaBillerCode}` : ''}${tx.vaNumber ? ` · VA ${tx.vaNumber}` : ''}${tx.expiresAt ? ` · Batas ${formatDateTimeId(tx.expiresAt)}` : ''}`}
                          </p>
                          {tx.transferProofDataUrl && (
                            <p className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] mt-1">
                              <ImageIcon className="w-3 h-3" />
                              Foto bukti transfer terlampir
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {tx.gatewayOrderId && (
                            <button
                              type="button"
                              disabled={checkingTxId === tx.id}
                              onClick={() => void handleCheckBankStatus(tx)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  checkingTxId === tx.id ? 'animate-spin' : ''
                                }`}
                              />
                              {checkingTxId === tx.id ? 'Mengecek...' : 'Cek Status Bank'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setPendingTxToResume(tx);
                              setCheckoutInvoices(relatedInvs);
                            }}
                            className="px-3.5 py-2 text-xs font-semibold text-amber-950 bg-amber-100 border border-amber-200 rounded-xl hover:bg-amber-200/70"
                          >
                            {tx.method === 'bank_transfer'
                              ? 'Lihat Status & Detail'
                              : 'Lihat Kode Bayar'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Analytics Rail (Matches Reference Right Rail) */}
          <div className="xl:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
              <div className="flex items-center gap-4">
                <CircularProgressRing percent={paidPercent} size={64} strokeWidth={6} />
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold text-slate-900">
                    Total Sudah Lunas
                  </p>
                  <p className="font-mono text-base font-bold text-[#2563EB] tabular-nums mt-0.5">
                    {formatRupiah(totals.paid)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {paidCount} tagihan selesai
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[#F8FAFD] border border-slate-200/60">
                  <p className="text-[11px] text-slate-500">Total Belum Bayar</p>
                  <p className="font-mono text-sm font-bold text-slate-900 tabular-nums mt-1">
                    {formatRupiah(totals.unpaid)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{unpaidCount} tagihan aktif</p>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFD] border border-slate-200/60">
                  <p className="text-[11px] text-slate-500">Menunggu Pembayaran / Verifikasi</p>
                  <p className="font-mono text-sm font-bold text-amber-600 tabular-nums mt-1">
                    {formatRupiah(totals.pending)}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{pendingCount} sesi berjalan</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabel Tagihan */}
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Daftar Tagihan Siswa
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Centang satu atau beberapa tagihan untuk satu siswa lalu bayar sekaligus via Transfer Bank, VA, atau QRIS.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start sm:self-auto overflow-x-auto max-w-full">
              {(
                [
                  ['all', 'Semua'],
                  ['unpaid', 'Belum Bayar'],
                  ['pending_payment', 'Menunggu'],
                  ['paid', 'Lunas'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    statusFilter === key
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <FileText className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold text-slate-900">
                Tidak ada tagihan pada filter ini
              </p>
              <p className="text-xs text-slate-500">
                Tagihan SPP, daftar ulang, jemputan, atau tagihan manual dari sekolah akan muncul di sini.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAFD] border-b border-slate-200/80 text-xs text-slate-500">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">Pilih</th>
                    <th className="text-left font-medium px-4 py-3">Siswa &amp; Sekolah</th>
                    <th className="text-left font-medium px-4 py-3">Tagihan &amp; Kategori</th>
                    <th className="text-left font-medium px-4 py-3">Jatuh Tempo</th>
                    <th className="text-right font-medium px-4 py-3">Nominal</th>
                    <th className="text-left font-medium px-4 py-3">Status</th>
                    <th className="text-right font-medium px-4 py-3">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => {
                    const checked = selectedInvoiceIds.includes(inv.id);
                    return (
                      <tr
                        key={inv.id}
                        className={`transition-colors ${
                          checked ? 'bg-[#EEF4FF]/60' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="px-4 py-3.5 text-center">
                          {inv.status === 'unpaid' ? (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelectInvoice(inv)}
                              aria-label={`Pilih tagihan ${inv.title}`}
                              className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB] cursor-pointer"
                            />
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{inv.studentName}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {inv.schoolName} · {inv.studentLevel} ({inv.studentGrade})
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="font-medium text-slate-900">{inv.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {CATEGORY_LABELS[inv.category]} · {formatPeriodLabel(inv.period)}
                          </p>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                          {formatDateId(inv.dueDate)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {inv.status === 'paid' ? (
                            formatRupiah(inv.amount)
                          ) : (
                            <div>
                              <p>{formatRupiah(getInvoiceRemainingAmount(inv))}</p>
                              {getInvoicePaidAmount(inv) > 0 && (
                                <p className="text-[11px] font-normal text-[#2563EB]">
                                  Terbayar {formatRupiah(getInvoicePaidAmount(inv))} /{' '}
                                  {formatRupiah(inv.amount)}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          {inv.status === 'paid' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {STATUS_LABELS.paid}
                            </span>
                          )}
                          {inv.status === 'pending_payment' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                              <Clock className="w-3.5 h-3.5" />
                              {STATUS_LABELS.pending_payment}
                            </span>
                          )}
                          {inv.status === 'unpaid' && (
                            <span className="text-xs font-semibold text-red-700">
                              {STATUS_LABELS.unpaid}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {inv.status === 'unpaid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPendingTxToResume(null);
                                setCheckoutInvoices([inv]);
                              }}
                              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors"
                            >
                              Bayar Sekarang
                            </button>
                          )}
                          {inv.status === 'pending_payment' && (
                            <button
                              type="button"
                              onClick={() => handleOpenPendingTx(inv)}
                              className="px-3.5 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors"
                            >
                              {inv.paymentMethod === 'bank_transfer'
                                ? 'Lihat Status'
                                : 'Lihat Kode Bayar'}
                            </button>
                          )}
                          {inv.status === 'paid' && (
                            <button
                              type="button"
                              onClick={() => handleOpenReceiptForInvoice(inv)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                            >
                              <Receipt className="w-3.5 h-3.5" />
                              Kuitansi
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Riwayat Transaksi & Kuitansi */}
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-200/80">
            <h2 className="font-display text-base font-bold text-slate-900">
              Riwayat Pembayaran &amp; Kuitansi
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Catatan seluruh pembayaran lunas via Kasir Tunai, Transfer Bank, Virtual Account, maupun QRIS.
            </p>
          </div>

          {sortedTransactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Belum ada riwayat transaksi lunas.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F8FAFD] border-b border-slate-200/80 text-xs text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Tanggal Lunas</th>
                    <th className="text-left font-medium px-4 py-3">No. Kuitansi</th>
                    <th className="text-left font-medium px-4 py-3">Siswa</th>
                    <th className="text-left font-medium px-4 py-3">Rincian</th>
                    <th className="text-left font-medium px-4 py-3">Metode</th>
                    <th className="text-right font-medium px-4 py-3">Nominal</th>
                    <th className="text-right font-medium px-4 py-3">Kuitansi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDateTimeId(tx.settledAt)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {tx.receiptNumber}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-medium text-slate-900">{tx.studentName}</p>
                        <p className="text-xs text-slate-500">{tx.schoolName}</p>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-700">
                        {tx.invoiceTitles.join(', ')}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        {ACTIVE_METHOD_LABELS[tx.method]} · {tx.channelDetail}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatRupiah(tx.totalAmount)}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setReceiptTx(tx)}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                          >
                            Lihat
                          </button>
                          <button
                            type="button"
                            onClick={() => exportReceiptPdf(tx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#2563EB] bg-[#EEF4FF] border border-blue-200 rounded-lg hover:bg-blue-100"
                          >
                            <Download className="w-3 h-3" />
                            PDF
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

        {checkoutInvoices && (
          <CheckoutModal
            invoices={checkoutInvoices}
            pendingTransaction={pendingTxToResume}
            userUid={userUid}
            userEmail={userEmail}
            onClose={() => {
              setCheckoutInvoices(null);
              setPendingTxToResume(null);
            }}
            onSettled={(tx) => {
              setSelectedInvoiceIds([]);
              setToastMsg(
                `Pembayaran ${tx.receiptNumber} sebesar ${formatRupiah(tx.totalAmount)} telah lunas.`,
              );
            }}
          />
        )}

        {receiptTx && (
          <ReceiptModal transaction={receiptTx} onClose={() => setReceiptTx(null)} />
        )}
      </div>
    </AppShell>
  );
};
