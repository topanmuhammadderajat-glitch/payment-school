# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Multi-Tenant Isolation**: Every `feeTemplate`, `student`, `invoice`, and `transaction` belongs strictly to one `schoolId` (`exists(/databases/$(database)/documents/schools/$(schoolId))` on creation) and carries `authorizedFinanceEmails` (max 10) for rule-enforced `list` isolation.
2. **Role Integrity**: No user may self-assign `super_admin` or `school_finance` roles via `/users/{userId}` or `/admins/{userId}`. Only the bootstrapped Super Admin (`topanmuhammadderajat@gmail.com` with `email_verified == true`) or delegated `/admins/{uid}` entries can manage schools and admins.
3. **Immutable Ownership & Amounts**: `schoolId`, `id`, `createdAt`, and `createdBy` cannot be altered after creation. Parents (`Wali Murid`) cannot modify invoice `amount`, `category`, `title`, or `parentEmail`.
4. **Atomic Payment Settlement**: Marking an invoice `paid` requires an atomic batch update/create on the linked `transactions/{transactionId}` document (`status == 'settled'`) verified via `existsAfter` / `getAfter`.
5. **Terminal State Locking**: Paid invoices (`status == 'paid'`) and settled/cancelled transactions (`status in ['settled', 'cancelled']`) cannot be reverted or modified by non-Super-Admin users.
6. **Temporal Integrity**: All `createdAt` (on create) and `updatedAt` (on create/update) fields must equal `request.time`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Return `PERMISSION_DENIED`)
1. **Privilege Escalation on User Profile**: Unprivileged user writes `{ role: "super_admin" }` to `/users/{uid}`. (Blocked by `keys().hasOnly(...)` in `isValidUser`).
2. **Unverified Email Admin Spoof**: Token has `email: "topanmuhammadderajat@gmail.com"` with `email_verified: false`. (Blocked by `emailVerified()`).
3. **Cross-School Student Read/List**: School A finance user queries `/students` where `schoolId == "school_B"`. (Blocked by `request.auth.token.email in resource.data.authorizedFinanceEmails`).
4. **Parent Invoice Amount Tampering**: Parent updates `/invoices/{id}` changing `amount` from `500000` to `1` during payment. (Blocked by `incoming().amount == existing().amount` and `affectedKeys().hasOnly(...)`).
5. **Orphaned Invoice Creation**: School finance creates an invoice pointing to a non-existent `schoolId` or `studentId`. (Blocked by `exists(...)` parent check on create).
6. **Shadow Field Injection**: Malicious client adds `isBypassed: true` to `/schools/{id}` or `/invoices/{id}`. (Blocked by `data.keys().hasOnly(...)` in every `isValid*` helper).
7. **ID Poisoning**: Client attempts to create `/students/{1500-char-junk-id}`. (Blocked by `isValidId()` length `<= 128` and regex guard).
8. **Non-Atomic Invoice Mark Paid**: Parent sets invoice `status: "paid"` directly without creating/settling a linked transaction in the same batch. (Blocked by `getAfter(...).data.status == 'settled'`).
9. **Terminal State Revert**: Parent or external user tries to change a `paid` invoice back to `unpaid`. (Blocked by `existing().status != 'paid'`).
10. **PII Blanket Read**: Signed-in parent attempts `get` on `/users/{otherUid}` or `/students/{otherParentsChildId}`. (Blocked by owner/parentEmail check).
11. **Backdated Timestamp Forgery**: Client sends `createdAt: "2020-01-01T00:00:00Z"` instead of `serverTimestamp()`. (Blocked by `incoming().createdAt == request.time`).
12. **School Module/Admin Hijack by Parent**: Parent updates `/schools/{schoolId}` `adminEmails` to include their own email. (Blocked by Super Admin / existing school finance gate).
