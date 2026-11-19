import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X, CheckCircle2 } from 'lucide-react';
import { School, Transaction } from '../types';
import {
  ACTIVE_METHOD_LABELS,
  CATEGORY_LABELS,
  formatDateTimeId,
  formatRupiah,
} from '../utils/formatters';
import { exportReceiptPdf } from '../utils/exporters';

interface ReceiptModalProps {
  transaction: Transaction;
  school?: School;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  transaction,
  school,
  onClose,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex overflow-y-auto overscroll-contain p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Kuitansi Pembayaran Resmi"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="m-auto bg-white border border-slate-200/90 rounded-2xl w-full max-w-xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[90dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(15,23,42,0.2)] animate-panel-enter">
        <div className="h-1.5 w-full bg-[#2563EB] shrink-0" />
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/80 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Kuitansi Pembayaran Resmi
            </h3>
            <p className="text-xs font-mono text-slate-500 mt-0.5 tabular-nums truncate">
              {transaction.receiptNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors shrink-0"
            aria-label="Tutup kuitansi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200/80">
            <div>
              <p className="font-display text-base font-bold text-slate-900">
                {school?.name || transaction.schoolName}
              </p>
              {school?.address && (
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {school.address}
                  {school.city ? `, ${school.city}` : ''}
                </p>
              )}
              {(school?.npsn || school?.phone) && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {school.npsn ? `NPSN ${school.npsn}` : ''}
                  {school.npsn && school.phone ? ' · ' : ''}
                  {school.phone ? `Telp ${school.phone}` : ''}
                </p>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
              <span>LUNAS</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">Siswa</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {transaction.studentName}
              </p>
              <p className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                {transaction.studentNis} · {transaction.studentLevel} ({transaction.studentGrade})
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Detail Pembayaran</p>
              <p className="font-semibold text-slate-900 mt-0.5">
                {ACTIVE_METHOD_LABELS[transaction.method]}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {transaction.channelDetail} · {formatDateTimeId(transaction.settledAt)}
              </p>
              {transaction.method === 'bank_transfer' && transaction.transferSenderName && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Pengirim: {transaction.transferSenderName}
                  {transaction.bankAccountNumber ? ` → Rek ${transaction.bankAccountNumber}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/90 border-b border-slate-200/80 text-xs text-slate-600">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5">Rincian Tagihan</th>
                  <th className="text-left font-medium px-4 py-2.5">Kategori</th>
                  <th className="text-right font-medium px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transaction.invoiceTitles.map((title, idx) => (
                  <tr key={`${transaction.id}_${idx}`}>
                    <td className="px-4 py-3 text-slate-900 font-medium">{title}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {CATEGORY_LABELS[
                        (transaction.categories[idx] as keyof typeof CATEGORY_LABELS) || 'manual'
                      ] || transaction.categories[idx]}
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700 text-xs font-semibold">
                      Terbayar
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50/90 border-t border-slate-200/80">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-xs font-semibold text-slate-700">
                    TOTAL PEMBAYARAN
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-base text-slate-900 tabular-nums">
                    {formatRupiah(transaction.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {transaction.notes && (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-3">
              Catatan: {transaction.notes}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200/80 bg-slate-50/80 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            Cetak Halaman
          </button>
          <button
            type="button"
            onClick={() => exportReceiptPdf(transaction, school)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.22)]"
          >
            <Download className="w-3.5 h-3.5" />
            Unduh PDF A4
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
