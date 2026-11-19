import React, { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Landmark,
  LogOut,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  db,
  handleFirestoreError,
  isEmbeddedInAppBrowser,
  isRunningInIframe,
  OperationType,
  signInWithGoogle,
  signInWithGoogleRedirect,
  signOutUser,
} from '../firebase';
import {
  ALL_SCHOOL_LEVELS,
  EnabledModules,
  SchoolLevel,
} from '../types';
import {
  INDONESIAN_BANKS,
  generateSafeId,
  normalizeEmail,
} from '../utils/formatters';

interface AuthGateProps {
  loadingAuth: boolean;
  onAuthError?: (msg: string) => void;
  initialError?: { code?: string; message: string } | null;
}

const HERO_CAMPUS_IMAGE = '/src/assets/images/edukasir_campus_hero_1794960837040.jpg';
const TREASURY_DESK_IMAGE = '/src/assets/images/edukasir_treasury_desk_1794960838201.jpg';

export const AuthLandingScreen: React.FC<AuthGateProps> = ({ loadingAuth, initialError }) => {
  const [signingIn, setSigningIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [unauthorizedDomain, setUnauthorizedDomain] = useState('');
  const [showRedirectFallback, setShowRedirectFallback] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [deskImgFailed, setDeskImgFailed] = useState(false);
  const errorBoxRef = useRef<HTMLDivElement | null>(null);

  const inAppBrowser = isEmbeddedInAppBrowser();
  const inIframe = isRunningInIframe();

  const applyFormattedAuthError = (code: string, rawMsg: string) => {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    setErrorCode(code);
    if (code === 'auth/unauthorized-domain' || rawMsg.includes('unauthorized-domain')) {
      setUnauthorizedDomain(host);
      setShowRedirectFallback(false);
      setErrorMsg(
        'Domain aplikasi ini belum diizinkan di Firebase Authentication Authorized Domains (atau masih menunggu sinkronisasi). Pastikan domain persis di bawah ini terdaftar tanpa "https://".',
      );
    } else if (
      code === 'auth/popup-blocked' ||
      rawMsg.includes('popup-blocked') ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      setShowRedirectFallback(!inIframe);
      setErrorMsg(
        'Popup login Google diblokir atau tidak didukung oleh browser ini. Izinkan popup atau gunakan tombol Login Mode Redirect di bawah.',
      );
    } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      setShowRedirectFallback(!inIframe);
      setErrorMsg(
        'Jendela login Google tertutup sebelum proses selesai. Jika Anda memakai browser HP atau hosting luar, coba tombol Login Mode Redirect di bawah.',
      );
    } else if (code === 'auth/internal-error' || code === 'auth/network-request-failed') {
      setUnauthorizedDomain(host);
      setShowRedirectFallback(!inIframe);
      setErrorMsg(
        'Terjadi kendala koneksi/konfigurasi OAuth saat login Google. Pastikan domain hosting terdaftar di Authorized Domains & OAuth JavaScript Origins, atau coba Mode Redirect.',
      );
    } else {
      setShowRedirectFallback(!inIframe);
      setErrorMsg(rawMsg || 'Gagal masuk dengan Google.');
    }
    setTimeout(() => {
      errorBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  useEffect(() => {
    if (initialError && (initialError.code || initialError.message)) {
      applyFormattedAuthError(initialError.code || '', initialError.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError]);

  const handleLogin = async () => {
    setErrorMsg('');
    setErrorCode('');
    setUnauthorizedDomain('');
    setShowRedirectFallback(false);
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      if (
        !inIframe &&
        (code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment')
      ) {
        try {
          await signInWithGoogleRedirect();
          return;
        } catch (redirErr) {
          const rCode = (redirErr as { code?: string })?.code || code;
          const rMsg = redirErr instanceof Error ? redirErr.message : String(redirErr || rawMsg);
          applyFormattedAuthError(rCode, rMsg);
        }
      } else {
        applyFormattedAuthError(code, rawMsg);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleRedirectLogin = async () => {
    setErrorMsg('');
    setErrorCode('');
    setSigningIn(true);
    try {
      await signInWithGoogleRedirect();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      applyFormattedAuthError(code, rawMsg);
      setSigningIn(false);
    }
  };

  const handleCopyHost = () => {
    if (!unauthorizedDomain) return;
    void navigator.clipboard.writeText(unauthorizedDomain);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[#F6F8FC] bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.06),_transparent_52%)] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-3.5 flex items-center justify-between gap-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(37,99,235,0.28)] shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="font-display text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
              EduKasir
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#kapabilitas"
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0"
            >
              Kapabilitas
            </a>
            <a
              href="#peran"
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0"
            >
              Portal Pengguna
            </a>
            <a
              href="#alur-kerja"
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0"
            >
              Alur Kerja
            </a>
            <a
              href="#laporan"
              className="hover:text-[#2563EB] transition-colors whitespace-nowrap shrink-0"
            >
              Laporan A4
            </a>
          </nav>
          <button
            type="button"
            disabled={loadingAuth || signingIn}
            onClick={handleLogin}
            className="px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
          >
            {signingIn ? 'Menghubungkan...' : 'Masuk dengan Google'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-6 py-10 lg:py-16 space-y-14 lg:space-y-16">
        {/* Hero Split */}
        <section className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6 py-2">
            <p className="text-xs font-semibold tracking-wide text-[#2563EB]">
              Platform Keuangan Pendidikan Multi-Sekolah
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.65rem] font-bold tracking-tight text-slate-900 leading-[1.14] text-balance">
              Tata kelola pembayaran sekolah yang tertib, fleksibel, dan transparan.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl">
              Satu sistem terpadu untuk mengelola SPP bulanan, daftar ulang, jemputan, hingga tagihan manual dengan struktur jenjang TK–SMA dan tarif fleksibel per kelas. Mendukung loket kasir tunai, Virtual Account, QRIS, serta laporan akhir Excel dan PDF A4.
            </p>
            {inAppBrowser && (
              <div className="p-3.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-xl max-w-lg leading-relaxed">
                Anda membuka tautan dari browser bawaan aplikasi (WhatsApp/Instagram/Facebook). Google sering memblokir login di browser bawaan — ketuk titik tiga di pojok lalu pilih <strong>Buka di Chrome / Safari</strong>.
              </div>
            )}
            {errorMsg && (
              <div
                ref={errorBoxRef}
                className="p-4 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-xl max-w-lg space-y-2.5 leading-relaxed"
              >
                <p>{errorMsg}</p>
                {errorCode && (
                  <p className="font-mono text-[11px] text-red-700/90">
                    Kode: {errorCode}
                  </p>
                )}
                {unauthorizedDomain && (
                  <div className="bg-white border border-red-200 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-900 break-all">
                        {unauthorizedDomain}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyHost}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md shrink-0"
                      >
                        {copiedDomain ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedDomain ? 'Tersalin' : 'Salin Domain'}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-600 font-normal">
                      Buka <strong>Firebase Console → Authentication → Settings → Authorized domains → Add domain</strong>, lalu tempel domain di atas (tanpa https://).
                    </p>
                  </div>
                )}
                {showRedirectFallback && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={signingIn}
                      onClick={handleRedirectLogin}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors"
                    >
                      Coba Login Mode Redirect (Khusus HP / Hosting)
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <button
                type="button"
                disabled={loadingAuth || signingIn}
                onClick={handleLogin}
                className="group inline-flex items-center gap-2.5 px-6 py-3.5 text-sm font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 shadow-[0_6px_18px_rgba(37,99,235,0.28)]"
              >
                <span>{signingIn ? 'Memproses Login...' : 'Masuk ke Portal EduKasir'}</span>
                <ArrowRight className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5" />
              </button>
              <span className="text-xs text-slate-500">
                Otomatis mengenali peran Super Admin, Bag. Keuangan, atau Wali Murid.
              </span>
            </div>

            <div className="pt-4 border-t border-slate-200/80 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span>SPP Bulanan</span>
              <span aria-hidden="true">·</span>
              <span>Daftar Ulang</span>
              <span aria-hidden="true">·</span>
              <span>Jemputan Zona</span>
              <span aria-hidden="true">·</span>
              <span>Tagihan Manual Bebas</span>
            </div>
          </div>

          <div className="lg:col-span-6 relative rounded-[20px] overflow-hidden border border-slate-200/80 bg-gradient-to-br from-[#142754] via-[#1C3D7E] to-[#2652A8] min-h-[360px] lg:min-h-[450px] shadow-[0_12px_32px_rgba(20,39,84,0.16)]">
            {!heroImgFailed ? (
              <img
                src={HERO_CAMPUS_IMAGE}
                alt="Lingkungan sekolah modern mitra EduKasir"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-full object-cover object-center lg:h-full"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#142754] via-[#1C3D7E] to-[#2652A8] flex items-center justify-center p-8">
                <Building2 className="w-16 h-16 text-blue-300/60" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0F2046]/95 via-[#162E63]/55 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7 text-white space-y-4">
              <div>
                <p className="text-xs font-medium text-blue-200">Arsitektur Multi-Sekolah Fleksibel</p>
                <p className="text-base font-display font-semibold mt-0.5">
                  Setiap sekolah mengatur jenjang dan layanannya sendiri
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-3 pt-3 border-t border-white/15 text-xs">
                <div>
                  <p className="font-semibold text-white">Sekolah A · SD</p>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">
                    Jenjang SD saja · SPP bulanan fleksibel per kelas
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">Sekolah B · SD &amp; SMP</p>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">
                    SD &amp; SMP · SPP + Daftar Ulang tahunan
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">Sekolah C · TK–SMA</p>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">
                    Lengkap TK–SMA · SPP, Daftar Ulang, Jemputan &amp; Manual
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Full-Width 4-Metric Architectural Strip */}
        <section
          id="kapabilitas"
          className="bg-white border border-slate-200/80 rounded-2xl grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="p-6 space-y-1">
            <p className="text-xs font-medium text-slate-500">Struktur Jenjang</p>
            <p className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              TK · SD · SMP · SMA
            </p>
            <p className="text-xs text-slate-500">Pilih satu jenjang atau gabungan</p>
          </div>
          <div className="p-6 space-y-1">
            <p className="text-xs font-medium text-slate-500">Kanal Pembayaran</p>
            <p className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              Tunai, VA &amp; QRIS
            </p>
            <p className="text-xs text-slate-500">Kasir loket &amp; pembayaran digital</p>
          </div>
          <div className="p-6 space-y-1">
            <p className="text-xs font-medium text-slate-500">Fleksibilitas Tarif</p>
            <p className="font-display text-2xl font-bold text-slate-900 tabular-nums">
              Per Kelas &amp; Siswa
            </p>
            <p className="text-xs text-slate-500">Nominal bebas diatur bendahara</p>
          </div>
          <div className="p-6 space-y-1">
            <p className="text-xs font-medium text-slate-500">Ekspor Resmi</p>
            <p className="font-display text-2xl font-bold text-[#2563EB] tabular-nums">
              Excel &amp; PDF A4
            </p>
            <p className="text-xs text-slate-500">Format rapi lengkap dengan kop sekolah</p>
          </div>
        </section>

        {/* 3 Portal Showcase */}
        <section id="peran" className="space-y-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-[#2563EB]">Portal Pengguna Terintegrasi</p>
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 mt-1 text-balance">
              Dirancang khusus untuk kebutuhan pemilik platform, bendahara, dan orang tua.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="w-10 h-10 rounded-xl bg-[#EEF4FF] border border-blue-100 flex items-center justify-center text-[#2563EB]">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900">Super Admin Platform</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Kelola pendaftaran sekolah mitra, aktifkan kombinasi jenjang dan modul tiap sekolah, atur akses staf keuangan, serta pantau transaksi lintas institusi.
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-800">
                <Landmark className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900">Bagian Keuangan Sekolah</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Tetapkan tarif per tingkat atau zona jemputan, terbitkan tagihan rutin dan manual bebas, layani loket kasir tunai, serta verifikasi transfer VA dan QRIS.
                </p>
              </div>
            </div>

            <div id="laporan" className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <div className="w-10 h-10 rounded-xl bg-[#EEF4FF] border border-blue-100 flex items-center justify-center text-[#2563EB]">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-slate-900">Wali Murid &amp; Laporan A4</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Orang tua memeriksa tagihan anak dan membayar langsung lewat VA atau QRIS dengan kuitansi instan. Sekolah mengunduh laporan akhir Excel dan PDF kertas A4.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Editorial Treasury Feature Strip */}
        <section
          id="alur-kerja"
          className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden grid lg:grid-cols-12 items-stretch shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-center space-y-6">
            <div>
              <p className="text-xs font-semibold text-[#2563EB]">Alur Administrasi Terstruktur</p>
              <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 mt-1 text-balance">
                Dari pengaturan tarif hingga arsip laporan akhir siap cetak.
              </h2>
            </div>

            <div className="divide-y divide-slate-100 text-sm">
              <div className="py-4 first:pt-0">
                <p className="font-semibold text-slate-900">01. Konfigurasi Jenjang &amp; Tarif</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Aktifkan jenjang yang dimiliki sekolah serta nominal berbeda untuk tiap kelas, zona jemputan, maupun tarif khusus per siswa.
                </p>
              </div>
              <div className="py-4">
                <p className="font-semibold text-slate-900">02. Tagihan Rutin, Manual &amp; Multi-Kanal</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Terbitkan tagihan massal atau manual insidental. Wali murid membayar melalui VA dan QRIS, atau langsung di loket kasir tunai sekolah.
                </p>
              </div>
              <div className="py-4 last:pb-0">
                <p className="font-semibold text-slate-900">03. Laporan Akhir Excel &amp; Kertas A4</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Unduh rekapitulasi lengkap beserta kop surat resmi, tanda tangan kepala sekolah dan bendahara dalam format Excel (.xlsx) dan PDF A4.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 relative min-h-[280px] bg-slate-100">
            {!deskImgFailed ? (
              <img
                src={TREASURY_DESK_IMAGE}
                alt="Meja kerja administrasi keuangan sekolah dengan laporan A4"
                referrerPolicy="no-referrer"
                onError={() => setDeskImgFailed(true)}
                className="w-full h-full object-cover object-center lg:h-full"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center p-8">
                <FileSpreadsheet className="w-12 h-12 text-[#2563EB]/50" />
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>EduKasir · Platform Administrasi Pembayaran Pendidikan Multi-Sekolah</span>
          <button
            type="button"
            disabled={loadingAuth || signingIn}
            onClick={handleLogin}
            className="font-semibold text-[#2563EB] hover:text-[#1D4ED8] whitespace-nowrap"
          >
            Masuk Portal dengan Akun Google
          </button>
        </div>
      </footer>
    </div>
  );
};

interface UnassignedPortalProps {
  user: User;
  existingRequestSubmitted: boolean;
  onRequestSubmitted: () => void;
}

export const UnassignedPortal: React.FC<UnassignedPortalProps> = ({
  user,
  existingRequestSubmitted,
  onRequestSubmitted,
}) => {
  const [schoolName, setSchoolName] = useState('');
  const [city, setCity] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');
  const [levels, setLevels] = useState<SchoolLevel[]>(['SD']);
  const [modules, setModules] = useState<EnabledModules>({
    spp: true,
    daftarUlang: true,
    jemputan: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(existingRequestSubmitted);
  const [errorMsg, setErrorMsg] = useState('');

  const toggleLevel = (lvl: SchoolLevel) => {
    setLevels((prev) =>
      prev.includes(lvl)
        ? prev.length > 1
          ? prev.filter((l) => l !== lvl)
          : prev
        : [...prev, lvl],
    );
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSchoolName = schoolName.trim().slice(0, 120);
    const cleanCity = city.trim().slice(0, 80);
    if (cleanSchoolName.length < 2 || cleanCity.length < 2) {
      setErrorMsg('Nama sekolah dan kota minimal 2 karakter.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    const reqId = generateSafeId('req');
    try {
      await setDoc(doc(db, 'schoolRequests', reqId), {
        id: reqId,
        schoolName: cleanSchoolName,
        city: cleanCity,
        contactEmail: normalizeEmail(user.email || '').slice(0, 120),
        contactPhone: contactPhone.trim().slice(0, 30),
        bankName: bankName.trim().slice(0, 60),
        bankAccountNumber: bankAccountNumber.trim().slice(0, 40),
        bankAccountHolder: bankAccountHolder.trim().slice(0, 120),
        requestedLevels: levels,
        requestedModules: modules,
        applicantUid: user.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitted(true);
      onRequestSubmitted();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `schoolRequests/${reqId}`);
      } catch (wrapped) {
        setErrorMsg(
          wrapped instanceof Error
            ? wrapped.message
            : 'Gagal mengirim permohonan sekolah. Periksa koneksi dan coba lagi.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex flex-col">
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-5 sm:px-6 py-3.5 flex items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(37,99,235,0.28)] shrink-0">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="font-display text-lg font-extrabold text-slate-900 whitespace-nowrap">
            EduKasir
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-slate-600 hidden sm:inline">{user.email}</span>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>
      </header>

      <main className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6 animate-panel-enter">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-3 text-slate-900">
            <div className="w-9 h-9 rounded-xl bg-[#EEF4FF] border border-blue-100 flex items-center justify-center text-[#2563EB] shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-semibold">Akun Belum Terhubung ke Sekolah</h1>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Email <span className="font-mono font-medium text-slate-900">{user.email}</span> belum terdaftar sebagai Wali Murid maupun Bagian Keuangan Sekolah.
          </p>
          <p className="text-xs text-slate-500 leading-relaxed">
            Jika Anda Wali Murid, minta Bagian Keuangan sekolah menautkan email Google ini pada data siswa Anda. Jika Anda perwakilan sekolah yang ingin bergabung, ajukan pendaftaran sekolah melalui formulir berikut.
          </p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
            <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-800 shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Ajukan Pendaftaran Sekolah Mitra
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Lengkapi profil singkat sekolah untuk aktivasi oleh Super Admin.
              </p>
            </div>
          </div>

          {submitted ? (
            <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  Permohonan Sekolah Terkirim
                </p>
                <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                  Pengajuan Anda sedang ditinjau oleh Super Admin. Setelah disetujui, halaman ini otomatis membuka portal keuangan sekolah Anda.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitRequest} className="space-y-4">
              {errorMsg && (
                <div className="p-3.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl">
                  {errorMsg}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Nama Sekolah
                  </label>
                  <input
                    type="text"
                    required
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Contoh: SD-SMP Harapan Mulia"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Kota / Kabupaten
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Contoh: Yogyakarta"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Nomor Telepon / WhatsApp Bagian Keuangan
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="0812-xxxx-xxxx"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                />
              </div>

              <div className="p-4 bg-[#F8FAFD] border border-slate-200/80 rounded-xl space-y-3">
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    Rekening Bank Sekolah (Untuk Pembayaran Transfer Bank Langsung)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                    Begitu pendaftaran disetujui Super Admin, nomor dan nama rekening ini otomatis tampil di halaman pembayaran wali murid.
                  </p>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Nama Bank
                    </label>
                    <input
                      type="text"
                      list="unassigned-indo-bank-options"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="Contoh: Bank BSI / BCA / BRI"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                    <datalist id="unassigned-indo-bank-options">
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
                      Nama Rekening (Atas Nama)
                    </label>
                    <input
                      type="text"
                      value={bankAccountHolder}
                      onChange={(e) => setBankAccountHolder(e.target.value)}
                      placeholder="Yayasan / Bendahara Sekolah"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">
                  Jenjang yang Dikelola Sekolah (Fleksibel)
                </label>
                <div className="flex flex-wrap gap-2">
                  {ALL_SCHOOL_LEVELS.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => toggleLevel(lvl)}
                      className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-colors ${
                        levels.includes(lvl)
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
                  Modul Tagihan yang Dibutuhkan
                </label>
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {[
                    { key: 'spp' as const, label: 'SPP Bulanan' },
                    { key: 'daftarUlang' as const, label: 'Daftar Ulang' },
                    { key: 'jemputan' as const, label: 'Jemputan' },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={modules[item.key]}
                        onChange={(e) =>
                          setModules((prev) => ({ ...prev, [item.key]: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] disabled:opacity-50 transition-colors shadow-[0_2px_8px_rgba(37,99,235,0.25)]"
                >
                  {submitting ? 'Mengirim Pengajuan...' : 'Kirim Permohonan Sekolah'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
