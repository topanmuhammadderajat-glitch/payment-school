/**
 * Security Rules Verification Suite (Phase 0 Specification)
 * Verifies that all 12 adversarial payloads from security_spec.md are denied
 * by firestore.rules when executed against the Firestore Rules Emulator.
 */

export const DIRTY_DOZEN_CASES = [
  { id: 1, name: 'Privilege escalation via user profile shadow role', collection: 'users', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified email spoofing admin account', collection: 'schools', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Cross-tenant student list query across schools', collection: 'students', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Parent invoice amount tampering during payment', collection: 'invoices', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'Orphaned invoice referencing non-existent school or student', collection: 'invoices', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Shadow field injection on school or invoice document', collection: 'invoices', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Document ID poisoning exceeding 128 chars or invalid charset', collection: 'students', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Non-atomic invoice status mark paid without settled transaction', collection: 'invoices', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Terminal state revert on paid invoice or settled transaction', collection: 'transactions', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'PII blanket read on other user profile or other student', collection: 'students', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Client-forged createdAt timestamp instead of serverTimestamp', collection: 'feeTemplates', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Unauthorized adminEmails modification by parent account', collection: 'schools', expected: 'PERMISSION_DENIED' },
] as const;
