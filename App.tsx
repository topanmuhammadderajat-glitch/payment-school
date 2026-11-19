import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  completeGoogleRedirectSignIn,
  db,
  handleFirestoreError,
  OperationType,
  signOutUser,
  SUPER_ADMIN_EMAIL,
} from './firebase';
import {
  FeeTemplate,
  Invoice,
  School,
  SchoolRequest,
  Student,
  Transaction,
} from './types';
import { normalizeEmail } from './utils/formatters';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthLandingScreen, UnassignedPortal } from './components/AuthGate';
import { SuperAdminPortal } from './components/SuperAdminPortal';
import { SchoolFinancePortal } from './components/SchoolFinancePortal';
import { ParentPortal } from './components/ParentPortal';
import { ActivePortalView, PortalShellContext } from './components/AppShell';

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [redirectResolved, setRedirectResolved] = useState(false);
  const [redirectAuthError, setRedirectAuthError] = useState<{ code?: string; message: string } | null>(null);
  const [isDelegatedAdmin, setIsDelegatedAdmin] = useState(false);

  // Data Collections
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolRequests, setSchoolRequests] = useState<SchoolRequest[]>([]);
  const [feeTemplates, setFeeTemplates] = useState<FeeTemplate[]>([]);
  const [financeStudents, setFinanceStudents] = useState<Student[]>([]);
  const [financeInvoices, setFinanceInvoices] = useState<Invoice[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<Transaction[]>([]);

  const [parentStudents, setParentStudents] = useState<Student[]>([]);
  const [parentInvoices, setParentInvoices] = useState<Invoice[]>([]);
  const [parentTransactions, setParentTransactions] = useState<Transaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Navigation State
  const [portalView, setPortalView] = useState<ActivePortalView>('super_admin');
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [firestoreError, setFirestoreError] = useState<string>('');

  const reportFirestoreError = (err: unknown, op: OperationType, path: string) => {
    setLoadingData(false);
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      setFirestoreError(
        wrapped instanceof Error ? wrapped.message : 'Terjadi kendala akses database.',
      );
    }
  };

  const userEmail = useMemo(() => normalizeEmail(user?.email || ''), [user]);
  const isSuperAdmin = useMemo(
    () => Boolean(user && (userEmail === SUPER_ADMIN_EMAIL || isDelegatedAdmin)),
    [user, userEmail, isDelegatedAdmin],
  );

  // Complete any pending Google Redirect Sign-In (for hosted/mobile browsers)
  useEffect(() => {
    let active = true;
    completeGoogleRedirectSignIn()
      .then((result) => {
        if (!active) return;
        if (result?.user) {
          setUser(result.user);
          setRedirectAuthError(null);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const code = (err as { code?: string })?.code || '';
        const message = err instanceof Error ? err.message : String(err || '');
        if (code || message) {
          setRedirectAuthError({ code, message });
        }
      })
      .finally(() => {
        if (active) setRedirectResolved(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Auth listener & User Profile Sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      setFirestoreError('');
      if (firebaseUser) {
        setRedirectAuthError(null);
      }

      if (firebaseUser && firebaseUser.email && firebaseUser.emailVerified) {
        const cleanEmail = normalizeEmail(firebaseUser.email);
        const tokenEmail = firebaseUser.email;
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: firebaseUser.uid,
              email: tokenEmail,
              displayName: (firebaseUser.displayName || cleanEmail.split('@')[0]).slice(0, 120),
              photoURL: (firebaseUser.photoURL || '').slice(0, 500),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(
              userRef,
              {
                displayName: (firebaseUser.displayName || snap.data().displayName || cleanEmail).slice(0, 120),
                photoURL: (firebaseUser.photoURL || '').slice(0, 500),
                updatedAt: serverTimestamp(),
              },
              { merge: true },
            );
          }
        } catch (err) {
          reportFirestoreError(err, OperationType.WRITE, `users/${firebaseUser.uid}`);
        }

        try {
          const adminSnap = await getDoc(doc(db, 'admins', firebaseUser.uid));
          setIsDelegatedAdmin(adminSnap.exists());
        } catch {
          setIsDelegatedAdmin(false);
        }
      } else {
        setIsDelegatedAdmin(false);
      }
    });
    return () => unsub();
  }, []);

  // Firestore Real-time Listeners (strictly gated behind authenticated verified user)
  useEffect(() => {
    if (!authReady || !user || !userEmail) {
      setSchools([]);
      setSchoolRequests([]);
      setFeeTemplates([]);
      setFinanceStudents([]);
      setFinanceInvoices([]);
      setFinanceTransactions([]);
      setParentStudents([]);
      setParentInvoices([]);
      setParentTransactions([]);
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const unsubs: (() => void)[] = [];

    if (userEmail === SUPER_ADMIN_EMAIL) {
      unsubs.push(
        onSnapshot(
          collection(db, 'schools'),
          (snap) => {
            setSchools(snap.docs.map((d) => d.data() as School));
            setLoadingData(false);
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'schools'),
        ),
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'schoolRequests'),
          (snap) => setSchoolRequests(snap.docs.map((d) => d.data() as SchoolRequest)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'schoolRequests'),
        ),
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'feeTemplates'),
          (snap) => setFeeTemplates(snap.docs.map((d) => d.data() as FeeTemplate)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'feeTemplates'),
        ),
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'students'),
          (snap) => {
            const all = snap.docs.map((d) => d.data() as Student);
            setFinanceStudents(all);
            setParentStudents(all.filter((s) => s.parentEmail === userEmail));
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'students'),
        ),
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'invoices'),
          (snap) => {
            const all = snap.docs.map((d) => d.data() as Invoice);
            setFinanceInvoices(all);
            setParentInvoices(all.filter((i) => i.parentEmail === userEmail));
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'invoices'),
        ),
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'transactions'),
          (snap) => {
            const all = snap.docs.map((d) => d.data() as Transaction);
            setFinanceTransactions(all);
            setParentTransactions(all.filter((t) => t.parentEmail === userEmail));
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'transactions'),
        ),
      );
    } else {
      // School Finance Staff Queries (enforced by rules)
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schools'), where('adminEmails', 'array-contains', userEmail)),
          (snap) => {
            setSchools(snap.docs.map((d) => d.data() as School));
            setLoadingData(false);
          },
          (err) => reportFirestoreError(err, OperationType.LIST, 'schools'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'schoolRequests'), where('applicantUid', '==', user.uid)),
          (snap) => setSchoolRequests(snap.docs.map((d) => d.data() as SchoolRequest)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'schoolRequests'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'feeTemplates'),
            where('authorizedFinanceEmails', 'array-contains', userEmail),
          ),
          (snap) => setFeeTemplates(snap.docs.map((d) => d.data() as FeeTemplate)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'feeTemplates'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'students'),
            where('authorizedFinanceEmails', 'array-contains', userEmail),
          ),
          (snap) => setFinanceStudents(snap.docs.map((d) => d.data() as Student)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'students'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'invoices'),
            where('authorizedFinanceEmails', 'array-contains', userEmail),
          ),
          (snap) => setFinanceInvoices(snap.docs.map((d) => d.data() as Invoice)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'invoices'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(
            collection(db, 'transactions'),
            where('authorizedFinanceEmails', 'array-contains', userEmail),
          ),
          (snap) => setFinanceTransactions(snap.docs.map((d) => d.data() as Transaction)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'transactions'),
        ),
      );

      // Parent Queries (enforced by rules)
      unsubs.push(
        onSnapshot(
          query(collection(db, 'students'), where('parentEmail', '==', userEmail)),
          (snap) => setParentStudents(snap.docs.map((d) => d.data() as Student)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'students/parent'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'invoices'), where('parentEmail', '==', userEmail)),
          (snap) => setParentInvoices(snap.docs.map((d) => d.data() as Invoice)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'invoices/parent'),
        ),
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'transactions'), where('parentEmail', '==', userEmail)),
          (snap) => setParentTransactions(snap.docs.map((d) => d.data() as Transaction)),
          (err) => reportFirestoreError(err, OperationType.LIST, 'transactions/parent'),
        ),
      );
    }

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user, userEmail]);

  const isSchoolFinance = schools.length > 0;
  const isParent = parentStudents.length > 0;

  // Set sensible default portal view & selected school
  useEffect(() => {
    if (!user) return;
    if (isSuperAdmin) {
      if (!selectedSchoolId && schools.length > 0) {
        setSelectedSchoolId(schools[0].id);
      }
    } else if (isSchoolFinance) {
      setPortalView('school_finance');
      if (!selectedSchoolId && schools.length > 0) {
        setSelectedSchoolId(schools[0].id);
      }
    } else if (isParent) {
      setPortalView('parent');
    }
  }, [user, isSuperAdmin, isSchoolFinance, isParent, schools, selectedSchoolId]);

  const activeSchool = useMemo(
    () => schools.find((s) => s.id === selectedSchoolId) || schools[0] || null,
    [schools, selectedSchoolId],
  );

  const activeSchoolTemplates = useMemo(
    () => (activeSchool ? feeTemplates.filter((t) => t.schoolId === activeSchool.id) : []),
    [feeTemplates, activeSchool],
  );
  const activeSchoolStudents = useMemo(
    () => (activeSchool ? financeStudents.filter((s) => s.schoolId === activeSchool.id) : []),
    [financeStudents, activeSchool],
  );
  const activeSchoolInvoices = useMemo(
    () => (activeSchool ? financeInvoices.filter((i) => i.schoolId === activeSchool.id) : []),
    [financeInvoices, activeSchool],
  );
  const activeSchoolTransactions = useMemo(
    () => (activeSchool ? financeTransactions.filter((t) => t.schoolId === activeSchool.id) : []),
    [financeTransactions, activeSchool],
  );

  if (!authReady || !redirectResolved) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex items-center justify-center">
        <div className="text-sm font-medium text-slate-500">Memuat sesi EduKasir...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthLandingScreen loadingAuth={!authReady} initialError={redirectAuthError} />;
  }

  if (!loadingData && !isSuperAdmin && !isSchoolFinance && !isParent) {
    return (
      <UnassignedPortal
        user={user}
        existingRequestSubmitted={schoolRequests.some((r) => r.status === 'pending')}
        onRequestSubmitted={() => undefined}
      />
    );
  }

  const availableViews: { key: ActivePortalView; label: string }[] = [];
  if (isSuperAdmin) availableViews.push({ key: 'super_admin', label: 'Super Admin' });
  if ((isSuperAdmin || isSchoolFinance) && activeSchool) {
    availableViews.push({ key: 'school_finance', label: 'Bag. Keuangan Sekolah' });
  }
  if (isSuperAdmin || isParent) {
    availableViews.push({ key: 'parent', label: 'Wali Murid' });
  }

  const effectiveView: ActivePortalView = availableViews.some((v) => v.key === portalView)
    ? portalView
    : availableViews[0]?.key || 'parent';

  const shellContext: PortalShellContext = {
    userName: user.displayName || userEmail,
    userEmail,
    availableViews,
    effectiveView,
    onSelectView: (v) => setPortalView(v),
    onSignOut: () => void signOutUser(),
    firestoreError,
    onClearFirestoreError: () => setFirestoreError(''),
  };

  if (loadingData) {
    return (
      <div className="min-h-screen bg-[#F6F8FC] flex">
        <div className="hidden lg:block w-[252px] bg-white border-r border-slate-200/80 p-5 space-y-4">
          <div className="h-8 w-32 bg-slate-100 rounded-xl animate-pulse" />
          <div className="space-y-2 pt-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
          <div className="h-40 bg-white border border-slate-200/80 rounded-2xl animate-pulse" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-white border border-slate-200/80 rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {effectiveView === 'super_admin' && isSuperAdmin && (
        <SuperAdminPortal
          shell={shellContext}
          userUid={user.uid}
          userEmail={userEmail}
          schools={schools}
          schoolRequests={schoolRequests}
          students={financeStudents}
          invoices={financeInvoices}
          transactions={financeTransactions}
          onOpenSchoolPortal={(schId) => {
            setSelectedSchoolId(schId);
            setPortalView('school_finance');
          }}
        />
      )}

      {effectiveView === 'school_finance' && activeSchool && (
        <SchoolFinancePortal
          shell={shellContext}
          school={activeSchool}
          userUid={user.uid}
          userEmail={userEmail}
          feeTemplates={activeSchoolTemplates}
          students={activeSchoolStudents}
          invoices={activeSchoolInvoices}
          transactions={activeSchoolTransactions}
          allSchools={schools}
          onSwitchSchool={(id) => setSelectedSchoolId(id)}
        />
      )}

      {effectiveView === 'parent' && (
        <ParentPortal
          shell={shellContext}
          userUid={user.uid}
          userEmail={userEmail}
          userName={user.displayName || userEmail}
          students={parentStudents}
          invoices={parentInvoices}
          transactions={parentTransactions}
          loading={loadingData}
          isPreviewMode={isSuperAdmin && !isParent}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
