import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  LogOut,
  Menu,
  Plus,
  Search,
  Wallet,
  X,
} from 'lucide-react';

export type ActivePortalView = 'super_admin' | 'school_finance' | 'parent';

export interface PortalShellContext {
  userName: string;
  userEmail: string;
  availableViews: { key: ActivePortalView; label: string }[];
  effectiveView: ActivePortalView;
  onSelectView: (view: ActivePortalView) => void;
  onSignOut: () => void;
  firestoreError?: string;
  onClearFirestoreError?: () => void;
}

export interface ShellNavItem {
  key: string;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

export interface ShellSecondaryItem {
  id: string;
  label: string;
  meta?: string | number;
  active?: boolean;
  dotColorClass?: string;
  onClick: () => void;
}

export interface ShellProgressWidget {
  title: string;
  rightText: string;
  percent: number;
}

interface AppShellProps {
  shell: PortalShellContext;
  navItems: ShellNavItem[];
  activeNavKey: string;
  onSelectNav: (key: string) => void;
  mobilePrimaryNavKeys: [string, string, string];
  onMobilePrimaryAction: () => void;
  mobilePrimaryActionLabel: string;
  sidebarHeaderExtra?: React.ReactNode;
  secondarySectionTitle?: string;
  secondarySectionAction?: { label: string; onClick: () => void };
  secondaryItems?: ShellSecondaryItem[];
  progressWidget?: ShellProgressWidget;
  topSearchValue?: string;
  topSearchPlaceholder?: string;
  onTopSearchChange?: (val: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  shell,
  navItems,
  activeNavKey,
  onSelectNav,
  mobilePrimaryNavKeys,
  onMobilePrimaryAction,
  mobilePrimaryActionLabel,
  sidebarHeaderExtra,
  secondarySectionTitle,
  secondarySectionAction,
  secondaryItems,
  progressWidget,
  topSearchValue,
  topSearchPlaceholder,
  onTopSearchChange,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const userInitial =
    (shell.userName || shell.userEmail || 'E')
      .trim()
      .charAt(0)
      .toUpperCase() || 'E';

  const mobileTabLeft1 = navItems.find((i) => i.key === mobilePrimaryNavKeys[0]) || navItems[0];
  const mobileTabLeft2 = navItems.find((i) => i.key === mobilePrimaryNavKeys[1]) || navItems[1];
  const mobileTabRight1 = navItems.find((i) => i.key === mobilePrimaryNavKeys[2]) || navItems[2];

  const clampedPercent = Math.max(0, Math.min(100, Math.round(progressWidget?.percent ?? 0)));

  return (
    <div className="min-h-screen bg-[#F6F8FC] flex flex-col lg:flex-row">
      {/* Desktop Left White Sidebar (matches reference layout) */}
      <aside className="hidden lg:flex lg:flex-col w-[248px] xl:w-[260px] shrink-0 bg-white border-r border-slate-200/80 sticky top-0 h-screen z-30">
        {/* Brand Lockup */}
        <div className="px-5 h-16 flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_4px_12px_rgba(37,99,235,0.28)] shrink-0">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="font-display text-[17px] font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
            EduKasir
          </span>
        </div>

        {/* Scrollable Sidebar Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-4 space-y-5">
          {sidebarHeaderExtra && <div className="px-1">{sidebarHeaderExtra}</div>}

          {/* Primary Navigation */}
          <nav className="space-y-1" aria-label="Navigasi utama">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNavKey === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onSelectNav(item.key)}
                  className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#EEF4FF] text-[#2563EB] font-semibold'
                      : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-[17px] h-[17px] shrink-0 ${
                        active ? 'text-[#2563EB]' : 'text-slate-400'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span
                      className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${
                        active ? 'text-[#2563EB]' : 'text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Secondary Section (Schools / Children / Active Modules) */}
          {secondarySectionTitle && secondaryItems && secondaryItems.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-1.5">
              <div className="px-3 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-400 tracking-wide">
                  {secondarySectionTitle}
                </span>
                {secondarySectionAction && (
                  <button
                    type="button"
                    onClick={secondarySectionAction.onClick}
                    aria-label={secondarySectionAction.label}
                    className="p-1 text-slate-400 hover:text-[#2563EB] hover:bg-blue-50 rounded-md transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {secondaryItems.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={sub.onClick}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs transition-colors text-left ${
                      sub.active
                        ? 'bg-slate-100/90 text-slate-900 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-[3px] shrink-0 ${
                          sub.dotColorClass || 'bg-blue-500'
                        }`}
                      />
                      <span className="truncate">{sub.label}</span>
                    </span>
                    {sub.meta !== undefined && sub.meta !== '' && (
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                        {sub.meta}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Progress Meter + User Profile Footer */}
        <div className="p-3 border-t border-slate-100 space-y-2.5 shrink-0 bg-white">
          {progressWidget && (
            <div className="p-3 rounded-xl bg-[#F8FAFD] border border-slate-200/70 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-800 truncate">
                  {progressWidget.title}
                </span>
                <span className="font-mono font-medium text-slate-500 tabular-nums shrink-0">
                  {progressWidget.rightText}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200/80 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-blue-600 transition-all duration-500"
                  style={{ width: `${clampedPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-1.5 py-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200/80 text-slate-700 font-display text-xs font-bold flex items-center justify-center shrink-0">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate leading-tight">
                  {shell.userName}
                </p>
                <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
                  {shell.userEmail}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={shell.onSignOut}
              title="Keluar"
              aria-label="Keluar"
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Right Workspace Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Desktop Top Bar */}
        <header className="hidden lg:flex items-center justify-between gap-6 sticky top-0 z-20 h-16 px-8 bg-[#F6F8FC]/90 backdrop-blur-md border-b border-slate-200/70 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {shell.availableViews.length > 1 ? (
              <div className="flex items-center gap-1 p-1 bg-white border border-slate-200/80 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                {shell.availableViews.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => shell.onSelectView(v.key)}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      shell.effectiveView === v.key
                        ? 'bg-[#EEF4FF] text-[#2563EB] font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs font-semibold text-slate-500">
                {shell.availableViews[0]?.label || 'EduKasir'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onTopSearchChange && (
              <div className="relative w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={topSearchValue || ''}
                  onChange={(e) => onTopSearchChange(e.target.value)}
                  placeholder={topSearchPlaceholder || 'Cari...'}
                  className="w-full pl-9 pr-3.5 py-2 text-xs bg-white border border-slate-200/90 rounded-xl text-slate-900 placeholder:text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.02)] focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            )}
            <button
              type="button"
              onClick={shell.onSignOut}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200/90 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Keluar
            </button>
          </div>
        </header>

        {/* Mobile Compact Top App Bar (matches mobile reference) */}
        <header className="lg:hidden sticky top-0 z-30 h-14 px-4 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white flex items-center justify-center shadow-[0_3px_10px_rgba(37,99,235,0.28)] shrink-0">
              <Wallet className="w-3.5 h-3.5" />
            </div>
            <span className="font-display text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
              EduKasir
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {shell.availableViews.length > 1 && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="px-2.5 py-1.5 text-[11px] font-semibold text-[#2563EB] bg-[#EEF4FF] rounded-lg whitespace-nowrap"
              >
                {shell.availableViews.find((v) => v.key === shell.effectiveView)?.label}
              </button>
            )}
            <button
              type="button"
              onClick={shell.onSignOut}
              aria-label="Keluar"
              className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-600 flex items-center justify-center hover:bg-slate-100"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Main Viewport Content */}
        <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-24 lg:py-7 space-y-6 min-w-0">
          {shell.firestoreError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="font-semibold text-red-900">Kendala Sinkronisasi Database</p>
                <p className="leading-relaxed break-all">{shell.firestoreError}</p>
              </div>
              {shell.onClearFirestoreError && (
                <button
                  type="button"
                  onClick={shell.onClearFirestoreError}
                  className="font-semibold text-red-800 hover:text-red-950 shrink-0"
                >
                  Tutup
                </button>
              )}
            </div>
          )}

          {/* Mobile Compact Progress Strip (matches mobile reference Lv 1 bar) */}
          {progressWidget && (
            <div className="lg:hidden bg-white border border-slate-200/80 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              <span className="text-xs font-bold text-slate-900 whitespace-nowrap shrink-0">
                {progressWidget.title}
              </span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-blue-600 transition-all duration-500"
                  style={{ width: `${clampedPercent}%` }}
                />
              </div>
              <span className="font-mono text-[11px] font-semibold text-slate-600 tabular-nums whitespace-nowrap shrink-0">
                {progressWidget.rightText}
              </span>
            </div>
          )}

          {children}
        </main>
      </div>

      {/* Mobile Fixed 5-Slot Bottom Navigation Bar (matches mobile reference) */}
      <nav
        aria-label="Navigasi bawah mobile"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/80 pb-safe shadow-[0_-4px_20px_rgba(15,23,42,0.05)]"
      >
        <div className="h-16 px-2 grid grid-cols-5 items-center max-w-lg mx-auto">
          {[mobileTabLeft1, mobileTabLeft2].map((item) => {
            if (!item) return <div key="empty-l" />;
            const Icon = item.icon;
            const active = activeNavKey === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelectNav(item.key)}
                className={`flex flex-col items-center justify-center min-h-[44px] gap-1 transition-colors ${
                  active ? 'text-[#2563EB]' : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-tight truncate max-w-[64px]">
                  {item.shortLabel || item.label}
                </span>
              </button>
            );
          })}

          {/* Center Prominent Royal Blue '+' Action Button */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onMobilePrimaryAction}
              aria-label={mobilePrimaryActionLabel}
              className="w-11 h-11 rounded-2xl bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-95 text-white flex items-center justify-center shadow-[0_6px_16px_rgba(37,99,235,0.38)] transition-transform"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>

          {mobileTabRight1 ? (
            <button
              type="button"
              onClick={() => onSelectNav(mobileTabRight1.key)}
              className={`flex flex-col items-center justify-center min-h-[44px] gap-1 transition-colors ${
                activeNavKey === mobileTabRight1.key
                  ? 'text-[#2563EB]'
                  : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <mobileTabRight1.icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold tracking-tight truncate max-w-[64px]">
                {mobileTabRight1.shortLabel || mobileTabRight1.label}
              </span>
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-1 transition-colors ${
              mobileMenuOpen ? 'text-[#2563EB]' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-tight">Menu</span>
          </button>
        </div>
      </nav>

      {/* Mobile Slide-Up Menu Bottom Sheet (via Portal) */}
      {mobileMenuOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 lg:hidden bg-slate-950/50 backdrop-blur-xs flex items-end"
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi"
            onClick={(e) => {
              if (e.target === e.currentTarget) setMobileMenuOpen(false);
            }}
          >
            <div className="w-full bg-white rounded-t-3xl max-h-[85dvh] flex flex-col overflow-hidden shadow-2xl animate-sheet-up pb-safe">
              <div className="pt-3 pb-2 flex justify-center shrink-0">
                <div className="w-10 h-1.5 rounded-full bg-slate-200" />
              </div>
              <div className="px-5 pb-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#EEF4FF] text-[#2563EB] font-display text-xs font-bold flex items-center justify-center shrink-0">
                    {userInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{shell.userName}</p>
                    <p className="text-[11px] text-slate-500 truncate">{shell.userEmail}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Tutup menu"
                  className="p-2 text-slate-400 hover:text-slate-900 rounded-xl hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-5 overflow-y-auto overscroll-contain flex-1 min-h-0">
                {/* Role Switcher */}
                {shell.availableViews.length > 1 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Portal Pengguna
                    </p>
                    <div className="grid grid-cols-1 gap-1.5">
                      {shell.availableViews.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => {
                            shell.onSelectView(v.key);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                            shell.effectiveView === v.key
                              ? 'bg-[#EEF4FF] text-[#2563EB]'
                              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{v.label}</span>
                          <ChevronRight className="w-4 h-4 opacity-60" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {sidebarHeaderExtra && <div>{sidebarHeaderExtra}</div>}

                {/* All Navigation Tabs */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Menu Navigasi
                  </p>
                  <div className="space-y-1">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeNavKey === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            onSelectNav(item.key);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm transition-colors ${
                            active
                              ? 'bg-[#EEF4FF] text-[#2563EB] font-semibold'
                              : 'text-slate-700 font-medium hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span>{item.label}</span>
                          </span>
                          {typeof item.count === 'number' && item.count > 0 && (
                            <span className="font-mono text-xs font-semibold tabular-nums">
                              {item.count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Secondary Section */}
                {secondarySectionTitle && secondaryItems && secondaryItems.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      {secondarySectionTitle}
                    </p>
                    <div className="space-y-1">
                      {secondaryItems.map((sub) => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => {
                            sub.onClick();
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs transition-colors ${
                            sub.active
                              ? 'bg-slate-100 text-slate-900 font-semibold'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-2 h-2 rounded-[3px] shrink-0 ${
                                sub.dotColorClass || 'bg-blue-500'
                              }`}
                            />
                            <span className="truncate">{sub.label}</span>
                          </span>
                          {sub.meta !== undefined && sub.meta !== '' && (
                            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                              {sub.meta}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      shell.onSignOut();
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200/80 rounded-xl hover:bg-red-100"
                  >
                    <LogOut className="w-4 h-4" />
                    Keluar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

interface CircularProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
}

export const CircularProgressRing: React.FC<CircularProgressRingProps> = ({
  percent,
  size = 64,
  strokeWidth = 6,
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#F59E0B"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute font-mono text-xs font-bold text-slate-900 tabular-nums">
        {clamped}%
      </span>
    </div>
  );
};
