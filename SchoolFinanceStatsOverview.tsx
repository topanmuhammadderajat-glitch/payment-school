import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  TrendingUp,
} from 'lucide-react';
import { Invoice, Transaction } from '../types';
import {
  formatPeriodLabel,
  formatRupiah,
  getInvoiceRemainingAmount,
} from '../utils/formatters';

type TrendRange = '6m' | '14d' | '30d';

interface TrendPoint {
  key: string;
  label: string;
  fullLabel: string;
  amount: number;
  txCount: number;
}

interface SchoolFinanceStatsOverviewProps {
  invoices: Invoice[];
  transactions: Transaction[];
  onNavigateTab: (tab: 'billing' | 'cashier' | 'reports') => void;
  onViewUnpaidInvoices: () => void;
}

const SHORT_MONTHS_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function parseTxDate(tx: Transaction): Date | null {
  if (tx.settledAt) {
    const d = new Date(tx.settledAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const raw = tx.createdAt || tx.updatedAt;
  if (!raw) return null;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'object') {
    const maybeTs = raw as { toDate?: () => Date; seconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      const d = maybeTs.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof maybeTs.seconds === 'number') {
      return new Date(maybeTs.seconds * 1000);
    }
  }
  return null;
}

function parseDueDateEndOfDay(dueDate?: string): Date | null {
  if (!dueDate) return null;
  const trimmed = dueDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatCompactRupiah(value: number): string {
  if (value <= 0) return 'Rp 0';
  if (value >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return `Rp ${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace('.', ',')} M`;
  }
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return `Rp ${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1).replace('.', ',')} jt`;
  }
  if (value >= 1_000) {
    return `Rp ${Math.round(value / 1_000)} rb`;
  }
  return `Rp ${Math.round(value)}`;
}

function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const SchoolFinanceStatsOverview: React.FC<SchoolFinanceStatsOverviewProps> = ({
  invoices,
  transactions,
  onNavigateTab,
  onViewUnpaidInvoices,
}) => {
  const [range, setRange] = useState<TrendRange>('6m');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const summary = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentMonthKey = toMonthKey(now);

    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const prevMonthKey = toMonthKey(prevMonthDate);

    const settledTxs = transactions.filter((t) => t.status === 'settled');

    let thisMonthRevenue = 0;
    let thisMonthTxCount = 0;
    let prevMonthRevenue = 0;
    let todayRevenue = 0;
    const todayKey = toDayKey(now);

    settledTxs.forEach((tx) => {
      const txDate = parseTxDate(tx);
      if (!txDate) return;
      const mKey = toMonthKey(txDate);
      if (mKey === currentMonthKey) {
        thisMonthRevenue += tx.totalAmount;
        thisMonthTxCount += 1;
      } else if (mKey === prevMonthKey) {
        prevMonthRevenue += tx.totalAmount;
      }
      if (toDayKey(txDate) === todayKey) {
        todayRevenue += tx.totalAmount;
      }
    });

    const momDeltaPercent =
      prevMonthRevenue > 0
        ? Math.round(((thisMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)
        : null;

    // Overdue vs Upcoming Unpaid Invoices
    const unpaidInvoices = invoices.filter((i) => i.status !== 'paid');
    let overdueAmount = 0;
    let overdueCount = 0;
    const overdueStudentIds = new Set<string>();
    let upcomingUnpaidAmount = 0;
    let upcomingUnpaidCount = 0;

    unpaidInvoices.forEach((inv) => {
      const rem = getInvoiceRemainingAmount(inv);
      const due = parseDueDateEndOfDay(inv.dueDate);
      if (due && due.getTime() < now.getTime()) {
        overdueAmount += rem;
        overdueCount += 1;
        overdueStudentIds.add(inv.studentId);
      } else {
        upcomingUnpaidAmount += rem;
        upcomingUnpaidCount += 1;
      }
    });

    return {
      currentPeriodLabel: formatPeriodLabel(currentMonthKey),
      thisMonthRevenue,
      thisMonthTxCount,
      prevMonthRevenue,
      momDeltaPercent,
      todayRevenue,
      overdueAmount,
      overdueCount,
      overdueStudentCount: overdueStudentIds.size,
      upcomingUnpaidAmount,
      upcomingUnpaidCount,
      totalUnpaidAmount: overdueAmount + upcomingUnpaidAmount,
    };
  }, [invoices, transactions]);

  const trendPoints = useMemo<TrendPoint[]>(() => {
    const now = new Date();
    const settledTxs = transactions.filter((t) => t.status === 'settled');

    if (range === '6m') {
      const buckets = new Map<string, TrendPoint>();
      for (let offset = 5; offset >= 0; offset -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        const key = toMonthKey(d);
        buckets.set(key, {
          key,
          label: SHORT_MONTHS_ID[d.getMonth()],
          fullLabel: formatPeriodLabel(key),
          amount: 0,
          txCount: 0,
        });
      }
      settledTxs.forEach((tx) => {
        const d = parseTxDate(tx);
        if (!d) return;
        const b = buckets.get(toMonthKey(d));
        if (b) {
          b.amount += tx.totalAmount;
          b.txCount += 1;
        }
      });
      return Array.from(buckets.values());
    }

    const totalDays = range === '14d' ? 14 : 30;
    if (range === '14d') {
      const buckets = new Map<string, TrendPoint>();
      for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
        const key = toDayKey(d);
        const dayNum = String(d.getDate()).padStart(2, '0');
        const monShort = SHORT_MONTHS_ID[d.getMonth()];
        buckets.set(key, {
          key,
          label: `${dayNum} ${monShort}`,
          fullLabel: `${dayNum} ${monShort} ${d.getFullYear()}`,
          amount: 0,
          txCount: 0,
        });
      }
      settledTxs.forEach((tx) => {
        const d = parseTxDate(tx);
        if (!d) return;
        const b = buckets.get(toDayKey(d));
        if (b) {
          b.amount += tx.totalAmount;
          b.txCount += 1;
        }
      });
      return Array.from(buckets.values());
    }

    // 30d grouped into 10 clean 3-day buckets so labels remain crisp on mobile & desktop
    const buckets: Array<TrendPoint & { startMs: number; endMs: number }> = [];
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    for (let i = 9; i >= 0; i -= 1) {
      const endDate = new Date(
        endOfToday.getFullYear(),
        endOfToday.getMonth(),
        endOfToday.getDate() - i * 3,
        23,
        59,
        59,
        999,
      );
      const startDate = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate() - 2,
        0,
        0,
        0,
        0,
      );
      const sDay = String(startDate.getDate()).padStart(2, '0');
      const eDay = String(endDate.getDate()).padStart(2, '0');
      const eMon = SHORT_MONTHS_ID[endDate.getMonth()];
      const sMon = SHORT_MONTHS_ID[startDate.getMonth()];
      buckets.push({
        key: `${toDayKey(startDate)}_${toDayKey(endDate)}`,
        label: `${eDay} ${eMon}`,
        fullLabel:
          sMon === eMon
            ? `${sDay}–${eDay} ${eMon} ${endDate.getFullYear()}`
            : `${sDay} ${sMon}–${eDay} ${eMon} ${endDate.getFullYear()}`,
        amount: 0,
        txCount: 0,
        startMs: startDate.getTime(),
        endMs: endDate.getTime(),
      });
    }
    settledTxs.forEach((tx) => {
      const d = parseTxDate(tx);
      if (!d) return;
      const ms = d.getTime();
      const target = buckets.find((b) => ms >= b.startMs && ms <= b.endMs);
      if (target) {
        target.amount += tx.totalAmount;
        target.txCount += 1;
      }
    });
    return buckets.map(({ key, label, fullLabel, amount, txCount }) => ({
      key,
      label,
      fullLabel,
      amount,
      txCount,
    }));
  }, [transactions, range]);

  const trendStats = useMemo(() => {
    const total = trendPoints.reduce((s, p) => s + p.amount, 0);
    const totalTx = trendPoints.reduce((s, p) => s + p.txCount, 0);
    const maxVal = Math.max(...trendPoints.map((p) => p.amount), 0);
    const peakPoint = trendPoints.reduce<TrendPoint | null>(
      (best, cur) => (!best || cur.amount > best.amount ? cur : best),
      null,
    );
    const avg = trendPoints.length > 0 ? Math.round(total / trendPoints.length) : 0;
    return { total, totalTx, maxVal, peakPoint, avg };
  }, [trendPoints]);

  // SVG Chart Geometry
  const chartWidth = 640;
  const chartHeight = 200;
  const padLeft = 58;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 30;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;

  const yMax = useMemo(() => {
    if (trendStats.maxVal <= 0) return 1_000_000;
    const raw = trendStats.maxVal * 1.18;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = magnitude / 2;
    return Math.ceil(raw / step) * step;
  }, [trendStats.maxVal]);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    value: Math.round(yMax * ratio),
    y: padTop + plotH - ratio * plotH,
  }));

  const coords = useMemo(() => {
    const count = trendPoints.length;
    if (count === 0) return [];
    return trendPoints.map((pt, idx) => {
      const x =
        count === 1
          ? padLeft + plotW / 2
          : padLeft + (idx / (count - 1)) * plotW;
      const y = padTop + plotH - (pt.amount / yMax) * plotH;
      return { ...pt, x, y, idx };
    });
  }, [trendPoints, plotW, plotH, yMax]);

  const linePath = useMemo(() => {
    if (coords.length === 0) return '';
    if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
    let d = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const p0 = coords[i];
      const p1 = coords[i + 1];
      const cpX = (p0.x + p1.x) / 2;
      d += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  }, [coords]);

  const areaPath = useMemo(() => {
    if (coords.length === 0 || !linePath) return '';
    const baseY = padTop + plotH;
    const first = coords[0];
    const last = coords[coords.length - 1];
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
  }, [coords, linePath, plotH]);

  const activePoint =
    hoveredIdx !== null && coords[hoveredIdx]
      ? coords[hoveredIdx]
      : coords[coords.length - 1] || null;

  const hasAnyTrendData = trendStats.total > 0;

  return (
    <section className="space-y-4" aria-label="Statistik Ringkasan Keuangan Real-Time">
      {/* 2 Highlight Cards: Pendapatan Bulan Ini & Tagihan Tertunggak */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Pendapatan Bulan Ini */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">
                Pendapatan Bulan Ini
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <CalendarDays className="w-3.5 h-3.5 text-[#2563EB]" />
                {summary.currentPeriodLabel}
              </span>
            </div>
            <p className="font-mono text-2xl sm:text-[26px] font-bold text-[#2563EB] tabular-nums tracking-tight break-all">
              {formatRupiah(summary.thisMonthRevenue)}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 pt-0.5">
              <span className="font-mono tabular-nums text-slate-700 font-medium">
                {summary.thisMonthTxCount} transaksi lunas
              </span>
              <span aria-hidden="true">·</span>
              {summary.momDeltaPercent !== null ? (
                <span
                  className={`inline-flex items-center gap-0.5 font-mono font-semibold tabular-nums ${
                    summary.momDeltaPercent >= 0 ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {summary.momDeltaPercent >= 0 ? (
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5" />
                  )}
                  {summary.momDeltaPercent >= 0 ? '+' : ''}
                  {summary.momDeltaPercent}% vs bulan lalu
                </span>
              ) : (
                <span>
                  Hari ini:{' '}
                  <strong className="font-mono font-semibold text-slate-700 tabular-nums">
                    {formatRupiah(summary.todayRevenue)}
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 truncate">
              Bulan lalu:{' '}
              <span className="font-mono font-semibold text-slate-700 tabular-nums">
                {formatRupiah(summary.prevMonthRevenue)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('reports')}
              className="inline-flex items-center gap-1 font-semibold text-[#2563EB] hover:text-[#1D4ED8] whitespace-nowrap shrink-0 transition-colors"
            >
              Rincian Laporan
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tagihan Tertunggak (Jatuh Tempo Terlewati) */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">
                Tagihan Tertunggak
              </p>
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                  summary.overdueCount > 0 ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {summary.overdueCount > 0 ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Lewat Jatuh Tempo
                  </>
                ) : (
                  'Terkendali'
                )}
              </span>
            </div>
            <p
              className={`font-mono text-2xl sm:text-[26px] font-bold tabular-nums tracking-tight break-all ${
                summary.overdueAmount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {formatRupiah(summary.overdueAmount)}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 pt-0.5">
              <span className="font-mono tabular-nums text-slate-700 font-medium">
                {summary.overdueCount} tagihan
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {summary.overdueStudentCount} siswa menunggak
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 truncate">
              Belum jatuh tempo:{' '}
              <span className="font-mono font-semibold text-slate-700 tabular-nums">
                {formatRupiah(summary.upcomingUnpaidAmount)}
              </span>
            </span>
            <button
              type="button"
              onClick={onViewUnpaidInvoices}
              className="inline-flex items-center gap-1 font-semibold text-[#2563EB] hover:text-[#1D4ED8] whitespace-nowrap shrink-0 transition-colors"
            >
              Tindak Lanjuti
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Grafik Tren Pembayaran Real-Time */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#2563EB] shrink-0" />
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
                Grafik Tren Pembayaran
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {activePoint ? (
                <>
                  Sorotan <strong className="text-slate-800">{activePoint.fullLabel}</strong> ·{' '}
                  <span className="font-mono font-semibold text-[#2563EB] tabular-nums">
                    {formatRupiah(activePoint.amount)}
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono tabular-nums">
                    {activePoint.txCount} transaksi
                  </span>
                </>
              ) : (
                'Pergerakan dana lunas sekolah secara real-time'
              )}
            </p>
          </div>

          {/* Interactive Range Switcher */}
          <div
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start sm:self-auto"
            role="tablist"
            aria-label="Rentang waktu grafik tren pembayaran"
          >
            {(
              [
                ['6m', '6 Bulan'],
                ['30d', '30 Hari'],
                ['14d', '14 Hari'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={range === key}
                onClick={() => {
                  setRange(key);
                  setHoveredIdx(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  range === key
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!hasAnyTrendData ? (
          <div className="py-10 px-4 text-center bg-[#F6F8FC] border border-dashed border-slate-200 rounded-xl space-y-3">
            <p className="text-xs font-semibold text-slate-700">
              Belum ada pembayaran lunas tercatat pada periode ini.
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Grafik tren akan terisi otomatis secara real-time begitu bendahara mencatat pembayaran tunai atau memverifikasi transfer bank wali murid.
            </p>
            <button
              type="button"
              onClick={() => onNavigateTab('cashier')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors whitespace-nowrap"
            >
              <Banknote className="w-3.5 h-3.5" />
              Catat Pembayaran di Kasir
            </button>
          </div>
        ) : (
          <div className="w-full overflow-x-auto no-scrollbar">
            <div className="min-w-[460px]">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-auto block select-none"
                role="img"
                aria-label="Grafik tren pembayaran sekolah"
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <defs>
                  <linearGradient id="edukasirTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid & Y-Axis Labels */}
                {yTicks.map((t, i) => (
                  <g key={i}>
                    <line
                      x1={padLeft}
                      y1={t.y}
                      x2={chartWidth - padRight}
                      y2={t.y}
                      stroke="#E2E8F0"
                      strokeWidth="1"
                      strokeDasharray={i === 0 ? undefined : '3 4'}
                    />
                    <text
                      x={padLeft - 8}
                      y={t.y + 3.5}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      {formatCompactRupiah(t.value)}
                    </text>
                  </g>
                ))}

                {/* Subtle Column Bars Behind Curve */}
                {coords.map((pt) => {
                  const barW = range === '6m' ? 28 : range === '30d' ? 18 : 14;
                  const barH = Math.max(0, padTop + plotH - pt.y);
                  const isActive = activePoint?.idx === pt.idx;
                  return (
                    <rect
                      key={`bar-${pt.key}`}
                      x={pt.x - barW / 2}
                      y={pt.y}
                      width={barW}
                      height={barH}
                      rx={5}
                      fill={isActive ? '#2563EB' : '#DBEAFE'}
                      fillOpacity={isActive ? 0.22 : 0.45}
                    />
                  );
                })}

                {/* Smooth Area Fill */}
                <path d={areaPath} fill="url(#edukasirTrendFill)" />

                {/* Smooth Trend Line */}
                <path
                  d={linePath}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Active Vertical Guide Line */}
                {activePoint && (
                  <line
                    x1={activePoint.x}
                    y1={padTop}
                    x2={activePoint.x}
                    y2={padTop + plotH}
                    stroke="#2563EB"
                    strokeOpacity="0.35"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Data Points & X-Axis Labels + Hit Targets */}
                {coords.map((pt, i) => {
                  const isActive = activePoint?.idx === pt.idx;
                  const showLabel =
                    range === '6m' ||
                    range === '30d' ||
                    i === 0 ||
                    i === coords.length - 1 ||
                    i % 2 === 0;
                  const hitW = coords.length > 1 ? plotW / (coords.length - 1) : plotW;
                  return (
                    <g key={pt.key}>
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isActive ? 5.5 : 3.5}
                        fill={isActive ? '#2563EB' : '#FFFFFF'}
                        stroke="#2563EB"
                        strokeWidth={isActive ? 2.5 : 2}
                      />
                      {showLabel && (
                        <text
                          x={pt.x}
                          y={chartHeight - 8}
                          textAnchor="middle"
                          className={`text-[10px] font-mono ${
                            isActive ? 'fill-[#2563EB] font-bold' : 'fill-slate-500'
                          }`}
                        >
                          {pt.label}
                        </text>
                      )}
                      {/* Invisible interactive hit target for hover & tap */}
                      <rect
                        x={pt.x - hitW / 2}
                        y={padTop}
                        width={hitW}
                        height={plotH + padBottom}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredIdx(pt.idx)}
                        onClick={() => setHoveredIdx(pt.idx)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        )}

        {/* Bottom Summary Strip (Unboxed Metadata with Tabular Numerals) */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="flex sm:flex-col justify-between gap-0.5">
            <span className="text-slate-500">Total Periode Terpilih</span>
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {formatRupiah(trendStats.total)}{' '}
              <span className="font-normal text-slate-400">({trendStats.totalTx} trx)</span>
            </span>
          </div>
          <div className="flex sm:flex-col justify-between gap-0.5">
            <span className="text-slate-500">
              Rata-rata per {range === '6m' ? 'Bulan' : range === '14d' ? 'Hari' : '3 Hari'}
            </span>
            <span className="font-mono font-bold text-slate-900 tabular-nums">
              {formatRupiah(trendStats.avg)}
            </span>
          </div>
          <div className="flex sm:flex-col justify-between gap-0.5">
            <span className="text-slate-500">Puncak Pembayaran</span>
            <span className="font-mono font-bold text-[#2563EB] tabular-nums">
              {trendStats.peakPoint && trendStats.peakPoint.amount > 0
                ? `${formatRupiah(trendStats.peakPoint.amount)} (${trendStats.peakPoint.label})`
                : 'Rp 0'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
