import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Image as ImageIcon,
  Landmark,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Invoice, School, Transaction } from '../types';
import {
  CATEGORY_LABELS,
  VA_BANKS,
  compressTransferProofImage,
  formatDateTimeId,
  formatRupiah,
  getInvoicePaidAmount,
  getInvoiceRemainingAmount,
} from '../utils/formatters';
import {
  GatewayConfig,
  cancelDigitalPayment,
  checkMidtransPaymentStatus,
  fetchGatewayConfig,
  initiateDigitalPayment,
  initiateDirectBankTransfer,
  settleDigitalPayment,
  updateBankTransferProof,
} from '../utils/paymentService';
import { exportReceiptPdf } from '../utils/exporters';

interface CheckoutModalProps {
  invoices: Invoice[];
  pendingTransaction?: Transaction | null;
  schoolCode?: string;
  school?: School;
  userUid: string;
  userEmail: string;
  onClose: () => void;
  onSettled: (tx: Transaction) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  invoices,
  pendingTransaction,
  schoolCode = 'SCH',
  school,
  userUid,
  userEmail,
  onClose,
  onSettled,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<'bank_transfer' | 'va' | 'qris'>(
    pendingTransaction?.method === 'qris'
      ? 'qris'
      : pendingTransaction?.method === 'va'
        ? 'va'
        : 'bank_transfer',
  );
  const [selectedBankCode, setSelectedBankCode] = useState<string>(VA_BANKS[0].code);
  const [activeTx, setActiveTx] = useState<Transaction | null>(pendingTransaction || null);
  const [settledTx, setSettledTx] = useState<Transaction | null>(null);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [bankStatusNote, setBankStatusNote] = useState('');
  const [copiedField, setCopiedField] = useState<
    'va' | 'biller' | 'webhook' | 'acc' | 'amount' | null
  >(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Direct Bank Transfer confirmation fields
  const [senderName, setSenderName] = useState(
    pendingTransaction?.transferSenderName || invoices[0]?.parentName || '',
  );
  const [transferReference, setTransferReference] = useState(
    pendingTransaction?.transferReference || '',
  );
  const [transferProofDataUrl, setTransferProofDataUrl] = useState(
    pendingTransaction?.transferProofDataUrl || '',
  );
  const [compressingProof, setCompressingProof] = useState(false);
  const [updatingProof, setUpdatingProof] = useState(false);
  const [proofNotice, setProofNotice] = useState('');

  // Partial payment (Cicilan) state when paying a single invoice
  const [paymentMode, setPaymentMode] = useState<'full' | 'partial'>('full');
  const [partialAmountInput, setPartialAmountInput] = useState('');

  const resolvedBankName = (
    school?.bankName ||
    invoices[0]?.schoolBankName ||
    activeTx?.bankName ||
    ''
  ).trim();
  const resolvedBankAccountNumber = (
    school?.bankAccountNumber ||
    invoices[0]?.schoolBankAccountNumber ||
    activeTx?.bankAccountNumber ||
    ''
  ).trim();
  const resolvedBankAccountHolder = (
    school?.bankAccountHolder ||
    invoices[0]?.schoolBankAccountHolder ||
    activeTx?.bankAccountHolder ||
    ''
  ).trim();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;
    setLoadingConfig(true);
    fetchGatewayConfig()
      .then((cfg) => {
        if (!mounted) return;
        setGatewayConfig(cfg);
        if (
          !pendingTransaction &&
          cfg.midtransConfigured &&
          !(school?.bankAccountNumber || invoices[0]?.schoolBankAccountNumber)
        ) {
          setSelectedMethod('va');
        }
      })
      .catch(() => {
        if (mounted) setGatewayConfig(null);
      })
      .finally(() => {
        if (mounted) setLoadingConfig(false);
      });
    return () => {
      mounted = false;
    };
  }, [pendingTransaction, school?.bankAccountNumber, invoices]);

  const singleRemaining =
    invoices.length === 1 ? getInvoiceRemainingAmount(invoices[0]) : 0;
  const fullRemainingTotal = invoices.reduce(
    (sum, inv) => sum + getInvoiceRemainingAmount(inv),
    0,
  );
  const canPartial =
    invoices.length === 1 && !activeTx && !settledTx && singleRemaining >= 2000;
  const parsedPartial = Number(partialAmountInput.replace(/\D/g, '')) || 0;
  const totalAmount = activeTx
    ? activeTx.totalAmount
    : canPartial && paymentMode === 'partial'
      ? parsedPartial
      : fullRemainingTotal;

  const getCustomPartialAmount = (): number | undefined => {
    if (!canPartial || paymentMode !== 'partial') return undefined;
    if (parsedPartial < 1000) {
      throw new Error('Nominal cicilan minimal Rp 1.000.');
    }
    if (parsedPartial > singleRemaining) {
      throw new Error(
        `Nominal cicilan tidak boleh melebihi sisa tagihan (${formatRupiah(singleRemaining)}).`,
      );
    }
    return parsedPartial < singleRemaining ? parsedPartial : undefined;
  };

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg('');
    setCompressingProof(true);
    try {
      const compressed = await compressTransferProofImage(file);
      setTransferProofDataUrl(compressed);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memproses gambar bukti transfer.',
      );
    } finally {
      setCompressingProof(false);
    }
  };

  const verifyWithMidtrans = useCallback(
    async (silent = false) => {
      if (!activeTx?.gatewayOrderId || settledTx) return;
      if (!silent) {
        setCheckingStatus(true);
        setErrorMsg('');
      }
      try {
        const res = await checkMidtransPaymentStatus(activeTx.gatewayOrderId);
        if (res.isSettled) {
          const settled = await settleDigitalPayment(activeTx, userUid, res.settlementTime);
          setSettledTx(settled);
          onSettled(settled);
        } else if (res.isCancelledOrExpired) {
          await cancelDigitalPayment(activeTx);
          setActiveTx(null);
          setErrorMsg(
            `Sesi pembayaran Midtrans berstatus "${res.transactionStatus}". Silakan buat nomor Virtual Account / QRIS baru.`,
          );
        } else if (!silent) {
          setBankStatusNote(
            `Status bank saat ini: Menunggu transfer (${res.transactionStatus}). Sistem mengecek otomatis setiap 5 detik.`,
          );
        }
      } catch (err) {
        if (!silent) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Gagal memeriksa status pembayaran dari server Midtrans.',
          );
        }
      } finally {
        if (!silent) setCheckingStatus(false);
      }
    },
    [activeTx, settledTx, userUid, onSettled],
  );

  // Auto-poll Midtrans every 5 seconds while waiting for real VA/QRIS payment
  useEffect(() => {
    if (!activeTx?.gatewayOrderId || settledTx) return;
    const timer = window.setInterval(() => {
      void verifyWithMidtrans(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeTx?.gatewayOrderId, settledTx, verifyWithMidtrans]);

  const handleSubmitBankTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setProofNotice('');
    if (!resolvedBankAccountNumber) {
      setErrorMsg(
        'Nomor Rekening sekolah belum diisi. Silakan hubungi Bagian Keuangan sekolah untuk melengkapi rekening bank di menu Jenjang & Tarif.',
      );
      return;
    }
    if (senderName.trim().length < 2) {
      setErrorMsg('Masukkan nama pengirim / pemilik rekening asal (minimal 2 karakter).');
      return;
    }
    setLoading(true);
    try {
      const customPartialAmount = getCustomPartialAmount();
      const tx = await initiateDirectBankTransfer({
        schoolCode: school?.code || schoolCode,
        invoices,
        bankName: resolvedBankName || 'Bank Sekolah',
        bankAccountNumber: resolvedBankAccountNumber,
        bankAccountHolder: resolvedBankAccountHolder || invoices[0]?.schoolName || 'Sekolah',
        transferSenderName: senderName,
        transferReference,
        transferProofDataUrl: transferProofDataUrl || undefined,
        payerUid: userUid,
        payerEmail: userEmail,
        customPartialAmount,
      });
      setActiveTx(tx);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengirim konfirmasi transfer bank.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTx) return;
    setErrorMsg('');
    setProofNotice('');
    setUpdatingProof(true);
    try {
      await updateBankTransferProof(
        activeTx.id,
        senderName,
        transferReference,
        transferProofDataUrl,
      );
      setActiveTx((prev) =>
        prev
          ? {
              ...prev,
              transferSenderName: senderName.trim(),
              transferReference: transferReference.trim(),
              transferProofDataUrl,
            }
          : prev,
      );
      setProofNotice('Data pengirim, referensi, dan foto bukti transfer berhasil disimpan untuk bendahara.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memperbarui data konfirmasi transfer.',
      );
    } finally {
      setUpdatingProof(false);
    }
  };

  const handleCreateCheckout = async () => {
    if (selectedMethod === 'bank_transfer') return;
    setErrorMsg('');
    setBankStatusNote('');
    setLoading(true);
    try {
      const customPartialAmount = getCustomPartialAmount();
      const bank = VA_BANKS.find((b) => b.code === selectedBankCode) || VA_BANKS[0];
      const tx = await initiateDigitalPayment({
        schoolCode: school?.code || schoolCode,
        invoices,
        method: selectedMethod,
        bankCode: bank.code,
        bankName: bank.name,
        payerUid: userUid,
        payerEmail: userEmail,
        customPartialAmount,
      });
      setActiveTx(tx);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuat sesi pembayaran Midtrans.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPending = async () => {
    if (!activeTx) return;
    setErrorMsg('');
    setLoading(true);
    try {
      await cancelDigitalPayment(activeTx);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membatalkan sesi pembayaran.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyText = (
    val: string,
    field: 'va' | 'biller' | 'webhook' | 'acc' | 'amount',
  ) => {
    void navigator.clipboard.writeText(val);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const isGatewayReady = Boolean(gatewayConfig?.midtransConfigured);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex overflow-y-auto overscroll-contain p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Pembayaran Tagihan Sekolah"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
        <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/80 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              {settledTx
                ? 'Pembayaran Terverifikasi Lunas'
                : activeTx
                  ? activeTx.method === 'bank_transfer'
                    ? 'Menunggu Verifikasi Bendahara Sekolah'
                    : 'Menunggu Pembayaran Bank / QRIS'
                  : 'Pembayaran Tagihan Sekolah'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {activeTx ? activeTx.schoolName : invoices[0]?.schoolName} ·{' '}
              {activeTx ? activeTx.studentName : invoices[0]?.studentName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors shrink-0"
            aria-label="Tutup modal pembayaran"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {errorMsg && (
            <div className="p-3.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl leading-relaxed">
              {errorMsg}
            </div>
          )}

          {settledTx ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="font-display text-lg font-bold text-slate-900">Tagihan Lunas</p>
                <p className="text-sm text-slate-600 mt-1">
                  Pembayaran sebesar{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatRupiah(settledTx.totalAmount)}
                  </span>{' '}
                  telah terverifikasi &amp; tercatat resmi.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-left text-xs space-y-2.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Nomor Kuitansi</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {settledTx.receiptNumber}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Kanal Pembayaran</span>
                  <span className="font-semibold text-slate-900">{settledTx.channelDetail}</span>
                </div>
                {settledTx.gatewayOrderId && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">ID Transaksi Midtrans</span>
                    <span className="font-mono text-slate-700 truncate">{settledTx.gatewayOrderId}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => exportReceiptPdf(settledTx, school)}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
                >
                  Unduh Kuitansi PDF
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : activeTx ? (
            <div className="space-y-5">
              <div className="p-5 bg-gradient-to-br from-[#142754] via-[#1C3D7E] to-[#2652A8] text-white rounded-2xl space-y-2.5 shadow-[0_8px_20px_rgba(20,39,84,0.18)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-blue-200/80">Total Tagihan</p>
                    <p className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
                      {formatRupiah(activeTx.totalAmount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-blue-200/80">Kanal</p>
                    <p className="text-xs font-semibold text-blue-100 mt-0.5">
                      {activeTx.channelDetail}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/15 flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-100/90">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-200" />
                    {activeTx.method === 'bank_transfer'
                      ? 'Transfer Langsung ke Rekening Sekolah · 0% Biaya Admin'
                      : activeTx.gatewayProvider === 'midtrans'
                        ? gatewayConfig?.isProduction
                          ? 'Midtrans Production (Bank Asli)'
                          : 'Midtrans Sandbox (Uji Coba Bank)'
                        : 'Sesi Pembayaran'}
                  </span>
                  {activeTx.expiresAt && (
                    <span className="inline-flex items-center gap-1 font-mono text-amber-300">
                      <Clock className="w-3 h-3" />
                      Batas: {formatDateTimeId(activeTx.expiresAt)}
                    </span>
                  )}
                </div>
              </div>

              {activeTx.method === 'bank_transfer' ? (
                <div className="space-y-4">
                  <div className="border border-slate-200/90 rounded-xl p-4 sm:p-5 space-y-3.5 bg-[#F8FAFD]">
                    <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                      <Landmark className="w-4 h-4 text-[#2563EB] shrink-0" />
                      <span>Rekening Bank Tujuan Sekolah</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2 bg-white border border-slate-200/80 rounded-xl px-3.5 py-2.5">
                        <div>
                          <p className="text-[11px] text-slate-500">Bank &amp; Atas Nama</p>
                          <p className="font-semibold text-slate-900 mt-0.5">
                            {resolvedBankName || 'Bank Sekolah'} · a.n.{' '}
                            {resolvedBankAccountHolder || activeTx.schoolName}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 bg-white border border-slate-200/80 rounded-xl px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-500">Nomor Rekening Sekolah</p>
                          <p className="font-mono text-base font-bold tracking-wider text-slate-900 tabular-nums mt-0.5 break-all">
                            {resolvedBankAccountNumber || '-'}
                          </p>
                        </div>
                        {resolvedBankAccountNumber && (
                          <button
                            type="button"
                            onClick={() => handleCopyText(resolvedBankAccountNumber, 'acc')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                          >
                            {copiedField === 'acc' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {copiedField === 'acc' ? 'Tersalin' : 'Salin'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border border-amber-200 bg-amber-50/75 rounded-xl p-4 space-y-2 text-xs text-amber-950">
                    <div className="flex items-start gap-2">
                      <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold">
                          Menunggu Verifikasi Mutasi oleh Bagian Keuangan Sekolah
                        </p>
                        <p className="text-amber-900/90 leading-relaxed">
                          Konfirmasi transfer Anda telah tercatat dengan nomor referensi kuitansi{' '}
                          <span className="font-mono font-semibold">{activeTx.receiptNumber}</span>.
                          Dana masuk langsung ke rekening sekolah dan status akan berubah{' '}
                          <strong>Lunas</strong> setelah bendahara mencocokkan mutasi rekening.
                        </p>
                      </div>
                    </div>
                  </div>

                  <form
                    onSubmit={handleUpdateProof}
                    className="border border-slate-200/80 rounded-xl p-4 space-y-3"
                  >
                    <p className="text-xs font-semibold text-slate-900">
                      Detail Konfirmasi Pengirim (Dapat Diperbarui)
                    </p>
                    {proofNotice && (
                      <div className="p-2.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
                        {proofNotice}
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Nama Pengirim / Pemilik Rekening Asal
                      </label>
                      <input
                        type="text"
                        required
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Nomor Referensi / Waktu Transfer / Catatan
                      </label>
                      <input
                        type="text"
                        value={transferReference}
                        onChange={(e) => setTransferReference(e.target.value)}
                        placeholder="Contoh: Ref 884210 / Transfer m-BCA 08:15"
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[11px] font-medium text-slate-600">
                        Foto / Screenshot Bukti Transfer (Otomatis Dikompres)
                      </label>
                      {transferProofDataUrl ? (
                        <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                          <img
                            src={transferProofDataUrl}
                            alt="Pratinjau bukti transfer"
                            className="w-16 h-16 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 text-[#2563EB]" />
                              Foto Bukti Siap Diperiksa Bendahara
                            </p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Sudah dioptimalkan untuk verifikasi mutasi sekolah.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTransferProofDataUrl('')}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg shrink-0"
                            aria-label="Hapus foto bukti"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                          {compressingProof ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 text-[#2563EB]" />
                          )}
                          <span>
                            {compressingProof
                              ? 'Mengompres gambar...'
                              : 'Unggah Foto Struk / Screenshot Transfer'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={compressingProof}
                            onChange={handleProofFileChange}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="submit"
                        disabled={updatingProof || loading || compressingProof}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#2563EB] bg-[#EEF4FF] border border-blue-200 rounded-xl hover:bg-blue-100 disabled:opacity-50"
                      >
                        {updatingProof && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Simpan Pembaruan Bukti
                      </button>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={loading || updatingProof}
                          onClick={handleCancelPending}
                          className="px-3.5 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-xl hover:bg-red-50 disabled:opacity-50"
                        >
                          Batalkan &amp; Ubah Metode
                        </button>
                        <button
                          type="button"
                          onClick={onClose}
                          className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
                        >
                          Tutup
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              ) : (
                <>
                  {activeTx.method === 'va' && activeTx.vaNumber && (
                    <div className="border border-slate-200/80 rounded-xl p-5 space-y-4">
                      <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                        <Building2 className="w-4 h-4 text-[#2563EB]" />
                        <span>
                          {activeTx.vaBillerCode
                            ? 'Mandiri Bill Payment (Kode Perusahaan & Kode Bayar)'
                            : 'Nomor Virtual Account Resmi'}
                        </span>
                      </div>

                      {activeTx.vaBillerCode && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] font-medium text-slate-500">
                            Kode Perusahaan / Biller Code
                          </p>
                          <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-2.5">
                            <span className="font-mono text-base font-bold tracking-wider text-slate-900 tabular-nums">
                              {activeTx.vaBillerCode}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(activeTx.vaBillerCode || '', 'biller')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                            >
                              {copiedField === 'biller' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              {copiedField === 'biller' ? 'Tersalin' : 'Salin'}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {activeTx.vaBillerCode && (
                          <p className="text-[11px] font-medium text-slate-500">
                            Kode Bayar / Bill Key
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-3.5">
                          <span className="font-mono text-lg font-bold tracking-wider text-slate-900 tabular-nums break-all">
                            {activeTx.vaNumber}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyText(activeTx.vaNumber || '', 'va')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                          >
                            {copiedField === 'va' ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {copiedField === 'va' ? 'Tersalin' : 'Salin'}
                          </button>
                        </div>
                      </div>

                      <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>
                          Buka aplikasi Mobile Banking atau ATM bank terkait ({activeTx.channelDetail}).
                        </li>
                        <li>
                          {activeTx.vaBillerCode
                            ? 'Pilih menu Bayar → Multipayment, lalu masukkan Kode Perusahaan & Kode Bayar di atas.'
                            : 'Pilih menu Transfer / Pembayaran Virtual Account lalu masukkan nomor VA di atas.'}
                        </li>
                        <li>
                          Pastikan nominal sesuai ({formatRupiah(activeTx.totalAmount)}). Status akan otomatis berubah Lunas begitu bank menerima dana.
                        </li>
                      </ol>
                    </div>
                  )}

                  {activeTx.method === 'qris' && (
                    <div className="border border-slate-200/80 rounded-xl p-5 flex flex-col items-center text-center space-y-4">
                      <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                        <QrCode className="w-4 h-4 text-[#2563EB]" />
                        <span>Pindai QRIS Dinamis Resmi</span>
                      </div>
                      <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
                        <QRCodeSVG
                          value={activeTx.qrisPayload || activeTx.id}
                          size={184}
                          level="M"
                          includeMargin={false}
                        />
                      </div>
                      <p className="text-xs text-slate-600 max-w-xs leading-relaxed">
                        Pindai menggunakan aplikasi m-banking atau e-wallet berlogo QRIS (GoPay, OVO, DANA, ShopeePay, BCA, Mandiri, BRI, BNI).
                      </p>
                    </div>
                  )}

                  {resolvedBankAccountNumber && (
                    <div className="p-3.5 bg-[#F8FAFD] border border-slate-200/80 rounded-xl text-xs text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-800">
                        Rekening Tujuan Pencairan Sekolah:
                      </span>{' '}
                      {resolvedBankName || 'Bank'} ·{' '}
                      <span className="font-mono text-slate-900">{resolvedBankAccountNumber}</span>{' '}
                      {resolvedBankAccountHolder ? `a.n. ${resolvedBankAccountHolder}` : ''}
                    </div>
                  )}

                  <div className="border border-blue-200/80 bg-[#EEF4FF]/70 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          Verifikasi Otomatis dari Bank (Real-Time)
                        </p>
                        <p className="text-xs text-slate-700 leading-relaxed mt-1">
                          {activeTx.gatewayOrderId
                            ? bankStatusNote ||
                              'Sistem mengecek status pembayaran langsung ke Midtrans setiap 5 detik. Setelah Anda transfer, klik tombol di bawah untuk cek instan.'
                            : 'Transaksi ini tidak memiliki Order ID Midtrans. Anda dapat membatalkannya untuk membuat kode VA/QRIS Midtrans baru.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      {activeTx.gatewayOrderId && (
                        <button
                          type="button"
                          disabled={loading || checkingStatus}
                          onClick={() => void verifyWithMidtrans(false)}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {checkingStatus ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Cek Status Pembayaran dari Bank
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={loading || checkingStatus}
                        onClick={handleCancelPending}
                        className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 disabled:opacity-50 transition-colors"
                      >
                        Batalkan Sesi
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="border border-slate-200/80 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {invoices.map((inv) => {
                  const rem = getInvoiceRemainingAmount(inv);
                  const paid = getInvoicePaidAmount(inv);
                  return (
                    <div key={inv.id} className="flex items-center justify-between px-4 py-3 text-sm gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{inv.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {CATEGORY_LABELS[inv.category]} · {inv.period}
                          {paid > 0 && (
                            <span className="text-[#2563EB] font-medium">
                              {' '}· Sudah dicicil {formatRupiah(paid)} dari {formatRupiah(inv.amount)}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="font-mono font-medium text-slate-900 tabular-nums shrink-0">
                        {formatRupiah(rem)}
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between px-4 py-3.5 bg-[#F8FAFD] font-semibold text-sm">
                  <span className="text-slate-700">
                    {canPartial && paymentMode === 'partial'
                      ? 'Nominal Cicilan yang Dibayar Sekarang'
                      : 'Total Pembayaran'}
                  </span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    {formatRupiah(totalAmount)}
                  </span>
                </div>
              </div>

              {canPartial && (
                <div className="p-4 bg-[#F8FAFD] border border-slate-200/80 rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Skema Pembayaran
                    </span>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg('');
                          setPaymentMode('full');
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          paymentMode === 'full'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Bayar Lunas
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg('');
                          setPaymentMode('partial');
                          if (!partialAmountInput) {
                            setPartialAmountInput(String(Math.round(singleRemaining / 2)));
                          }
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          paymentMode === 'partial'
                            ? 'bg-white text-[#2563EB] shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Cicil / Sebagian
                      </button>
                    </div>
                  </div>
                  {paymentMode === 'partial' && (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={1000}
                          max={singleRemaining}
                          value={partialAmountInput}
                          onChange={(e) => setPartialAmountInput(e.target.value)}
                          placeholder="Masukkan nominal cicilan"
                          className="flex-1 min-w-[160px] px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                        />
                        <div className="flex items-center gap-1.5">
                          {[0.25, 0.5, 0.75].map((pct) => (
                            <button
                              key={pct}
                              type="button"
                              onClick={() =>
                                setPartialAmountInput(String(Math.round(singleRemaining * pct)))
                              }
                              className="px-2.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                            >
                              {pct * 100}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600">
                        Sisa tagihan setelah pembayaran ini:{' '}
                        <span className="font-mono font-semibold text-slate-900">
                          {formatRupiah(Math.max(0, singleRemaining - parsedPartial))}
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-700">Pilih Metode Pembayaran</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setSelectedMethod('bank_transfer');
                    }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      selectedMethod === 'bank_transfer'
                        ? 'border-[#2563EB] bg-[#EEF4FF] text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Landmark className="w-4 h-4 text-[#2563EB] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">Transfer Bank</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        Langsung · 0% Admin
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setSelectedMethod('va');
                    }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      selectedMethod === 'va'
                        ? 'border-[#2563EB] bg-[#EEF4FF] text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-[#2563EB] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">Virtual Account</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        Otomatis Midtrans
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg('');
                      setSelectedMethod('qris');
                    }}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      selectedMethod === 'qris'
                        ? 'border-[#2563EB] bg-[#EEF4FF] text-slate-900'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <QrCode className="w-4 h-4 text-[#2563EB] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">QRIS</p>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        Semua E-Wallet
                      </p>
                    </div>
                  </button>
                </div>

                {selectedMethod === 'bank_transfer' ? (
                  <form onSubmit={handleSubmitBankTransfer} className="pt-2 space-y-4">
                    {!resolvedBankAccountNumber ? (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start gap-2.5 leading-relaxed">
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">
                            Rekening Bank Sekolah Belum Diisi
                          </p>
                          <p className="text-amber-900/90 mt-1">
                            Bagian Keuangan sekolah dapat mengisi Nama Bank, Nomor Rekening, dan Atas Nama Rekening di menu <strong>Jenjang &amp; Tarif → Simpan Konfigurasi</strong> agar langsung tampil di sini.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              Rekening Resmi {invoices[0]?.schoolName}
                            </span>
                            <span className="text-[11px] font-semibold text-emerald-700">
                              0% Biaya Admin
                            </span>
                          </div>

                          <div className="bg-white border border-slate-200/80 rounded-xl p-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-[11px] text-slate-500">
                                {resolvedBankName || 'Bank'} · a.n.{' '}
                                {resolvedBankAccountHolder || invoices[0]?.schoolName}
                              </p>
                              <p className="font-mono text-base font-bold text-slate-900 tracking-wider tabular-nums mt-0.5 break-all">
                                {resolvedBankAccountNumber}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyText(resolvedBankAccountNumber, 'acc')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 shrink-0"
                            >
                              {copiedField === 'acc' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              {copiedField === 'acc' ? 'Tersalin' : 'Salin'}
                            </button>
                          </div>

                          <div className="bg-white border border-slate-200/80 rounded-xl p-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[11px] text-slate-500">Nominal Transfer Persis</p>
                              <p className="font-mono text-sm font-bold text-[#2563EB] tabular-nums mt-0.5">
                                {formatRupiah(totalAmount)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyText(String(Math.round(totalAmount)), 'amount')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 shrink-0"
                            >
                              {copiedField === 'amount' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                              {copiedField === 'amount' ? 'Tersalin' : 'Salin Nominal'}
                            </button>
                          </div>

                          <p className="text-[11px] text-slate-600 leading-relaxed">
                            Transfer sesuai nominal melalui m-Banking, ATM, atau BI-FAST ke rekening di atas, lalu isi data pengirim di bawah ini. Dana masuk langsung ke rekening sekolah tanpa perantara.
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Nama Pengirim / Pemilik Rekening Asal
                            </label>
                            <input
                              type="text"
                              required
                              value={senderName}
                              onChange={(e) => setSenderName(e.target.value)}
                              placeholder="Contoh: Ibu Ratna / BCA"
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Nomor Referensi / Catatan Transfer (Opsional)
                            </label>
                            <input
                              type="text"
                              value={transferReference}
                              onChange={(e) => setTransferReference(e.target.value)}
                              placeholder="Contoh: Ref 884210 / Transfer m-BCA jam 08.15"
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              Lampirkan Foto / Screenshot Bukti Transfer (Opsional)
                            </label>
                            {transferProofDataUrl ? (
                              <div className="flex items-center gap-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                                <img
                                  src={transferProofDataUrl}
                                  alt="Bukti transfer"
                                  className="w-16 h-16 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">
                                    Foto Bukti Terlampir
                                  </p>
                                  <p className="text-[11px] text-slate-500 mt-0.5">
                                    Otomatis dikompres untuk dilihat bendahara sekolah.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setTransferProofDataUrl('')}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg shrink-0"
                                  aria-label="Hapus foto bukti transfer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <label className="flex items-center justify-center gap-2 px-3 py-2.5 border border-dashed border-slate-300 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                                {compressingProof ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#2563EB]" />
                                ) : (
                                  <Upload className="w-3.5 h-3.5 text-[#2563EB]" />
                                )}
                                <span>
                                  {compressingProof
                                    ? 'Mengompres gambar...'
                                    : 'Pilih Foto Struk / Screenshot Transfer'}
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  disabled={compressingProof}
                                  onChange={handleProofFileChange}
                                  className="hidden"
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/80">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={loading || !resolvedBankAccountNumber || invoices.length === 0}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
                      >
                        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Kirim Konfirmasi Sudah Transfer
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4 pt-1">
                    {loadingConfig ? (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2.5">
                        <Loader2 className="w-4 h-4 animate-spin text-[#2563EB] shrink-0" />
                        <span>Memeriksa koneksi Payment Gateway Midtrans...</span>
                      </div>
                    ) : !isGatewayReady ? (
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2.5 text-xs text-amber-950">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                          <div className="space-y-1.5">
                            <p className="font-semibold">
                              Virtual Account / QRIS Otomatis Memerlukan Akun Merchant Midtrans
                            </p>
                            <p className="text-amber-900/85 leading-relaxed">
                              Jika sekolah belum mendaftar merchant Midtrans (yang memerlukan verifikasi badan usaha/yayasan), gunakan metode <strong>Transfer Bank</strong> di sebelah kiri agar pembayaran tetap berjalan ke rekening bank asli sekolah sekarang juga.
                            </p>
                            <ol className="list-decimal list-inside space-y-1 text-amber-900/90 leading-relaxed pt-1">
                              <li>
                                Daftar akun merchant di <span className="font-mono font-semibold">dashboard.midtrans.com</span> untuk mengaktifkan VA &amp; QRIS otomatis.
                              </li>
                              <li>
                                Simpan <strong>Server Key</strong> di panel <strong>Secrets</strong> AI Studio dengan nama <span className="font-mono font-semibold">MIDTRANS_SERVER_KEY</span>.
                              </li>
                              {gatewayConfig?.webhookUrl && (
                                <li>
                                  Notification URL Midtrans:
                                  <div className="mt-1 flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2.5 py-1.5">
                                    <span className="font-mono text-[11px] text-slate-800 truncate flex-1">
                                      {gatewayConfig.webhookUrl}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(gatewayConfig.webhookUrl, 'webhook')}
                                      className="text-[11px] font-semibold text-[#2563EB] hover:text-[#1D4ED8] shrink-0"
                                    >
                                      {copiedField === 'webhook' ? 'Tersalin' : 'Salin'}
                                    </button>
                                  </div>
                                </li>
                              )}
                            </ol>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="px-3.5 py-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl flex items-center justify-between gap-2 text-xs text-emerald-900">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                          Terhubung ke Midtrans Core API
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-emerald-800">
                          {gatewayConfig?.isProduction ? 'PRODUCTION (LIVE)' : 'SANDBOX (UJI COBA)'}
                        </span>
                      </div>
                    )}

                    {selectedMethod === 'va' && (
                      <div className="space-y-2">
                        <label className="block text-xs font-medium text-slate-700">
                          Pilih Bank Penerbit Virtual Account
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {VA_BANKS.map((bank) => (
                            <button
                              key={bank.code}
                              type="button"
                              onClick={() => setSelectedBankCode(bank.code)}
                              className={`px-3.5 py-2.5 text-xs font-medium rounded-xl border text-left transition-colors ${
                                selectedBankCode === bank.code
                                  ? 'border-[#2563EB] bg-[#EEF4FF] text-[#2563EB] font-semibold'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {bank.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200/80">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={loading || loadingConfig || !isGatewayReady || invoices.length === 0}
                        onClick={handleCreateCheckout}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
                      >
                        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Buat Kode VA / QRIS Resmi
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
