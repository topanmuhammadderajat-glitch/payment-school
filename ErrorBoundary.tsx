import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Terjadi kesalahan sistem yang tidak terduga.',
    };
  }

  render() {
    if (this.state.hasError) {
      let readable = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; operationType?: string; path?: string };
        if (parsed.error) {
          readable = `${parsed.error} (${parsed.operationType || 'operasi'} pada ${parsed.path || 'database'})`;
        }
      } catch {
        // plain error message
      }

      return (
        <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200/80 rounded-2xl p-8 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="font-display text-lg font-bold text-slate-900">
                Terjadi Gangguan Aplikasi
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-6 break-words">
              {readable}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
