# AnonQuiz Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **PII Isolation (`/users/{userId}`)**: Host Google email (`email`) and profile metadata live strictly in `/users/{userId}` and can only be read or written by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`). No host PII is stored in publicly readable `/quizzes/{quizId}` or `/joinCodes/{joinCode}` documents.
2. **Host Ownership & Verified Email (`/quizzes/{quizId}`)**: Only signed-in users with `email_verified == true` can create, list, update, or delete quizzes, and only where `hostUid == request.auth.uid`. Draft quizzes cannot be read by non-owners.
3. **Zero-Trust Join Code Lookup (`/joinCodes/{joinCode}`)**: Collection `list` is strictly denied (`allow list: if false`). Anonymous participants resolve a 6-character join code via O(1) `get`. Creating a `/joinCodes/{joinCode}` document atomically requires the referenced `/quizzes/{quizId}` to exist after the batch (`existsAfter`) and belong to the caller.
4. **Anonymous Submission Master Gate (`/quizzes/{quizId}/submissions/{submissionId}`)**:
   - Anonymous participants require NO Firebase login to submit or read their own submission.
   - `submissionId` MUST equal `incoming().sessionToken` (an unguessable 16–128 char token stored in the participant's browser `localStorage`), preventing duplicate submissions per browser session and isolating single-document `get` access.
   - Creating a submission MUST fetch the parent `/quizzes/{quizId}` via `get()` and enforce: parent exists, `parent.status == 'active'`, `parent.expiresAt != null`, `request.time <= parent.expiresAt + duration.value(10, 's')`, and `incoming().hostUid == parent.hostUid`.
   - `allow list` on submissions is strictly restricted to the verified host (`resource.data.hostUid == request.auth.uid`) with ZERO `get()` calls inside `allow list`.
   - `allow update` on submissions is strictly restricted to the verified host updating ONLY whitelisted grading fields (`grading`, `totalScore`, `maxScore`, `reviewStatus`, `updatedAt`) while preserving immutable participant fields (`quizId`, `hostUid`, `sessionToken`, `anonId`, `submittedAt`, `answers`).

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unverified Email Host Create**: Authenticated user with `email_verified: false` attempts to create `/quizzes/quiz_1`.
2. **Host Identity Spoofing**: Verified host `uid_A` creates `/quizzes/quiz_1` with `hostUid: "uid_B"`.
3. **Shadow Field Injection on Quiz**: Verified host creates or updates `/quizzes/quiz_1` with an extra undeclared ghost field `isAdmin: true`.
4. **Draft Quiz Snooping**: Unauthenticated user attempts `get` on `/quizzes/quiz_draft_1` where `status == 'draft'`.
5. **Blanket Quiz Collection Scraping**: Unauthenticated user or another host attempts `list` on `/quizzes` without matching `hostUid == request.auth.uid`.
6. **Join Code Scraping**: Any client attempts `list` on `/joinCodes`.
7. **Orphaned Join Code Create**: Host attempts to create `/joinCodes/ABC123` pointing to a non-existent `quizId`.
8. **Expired Quiz Submission**: Anonymous participant attempts `create` on `/quizzes/quiz_expired/submissions/tok_1234567890abcdef` when `status == 'expired'` or past `expiresAt`.
9. **Spoofed HostUid on Submission**: Anonymous participant creates a submission under `quiz_1` (owned by `uid_A`) with `hostUid: "uid_B"`.
10. **Self-Approved Review Status on Create**: Anonymous participant submits with `reviewStatus: "reviewed"`.
11. **Participant Grading Tampering**: Anonymous participant (or non-owner) attempts `update` on their own submission to change `totalScore: 100`.
12. **Resource Poisoning / Oversized Payload & Invalid ID**: Client sends a 150KB `title` string, an empty `questions` array (`[]`), a `questions` array > 100 items, or a document ID containing illegal characters (`../evil`).
