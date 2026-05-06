# The 15 seeded fictional cases — pointer

The canonical 15-case demo dataset is **already in the repo** — no
download needed. Two co-equal sources of truth:

- **Code (executable):** [`apps/web/src/lib/case-seed.ts`](../apps/web/src/lib/case-seed.ts) — the seeded `MemoryEntry` records that auto-load into IndexedDB on first sign-in.
- **Documentation (human-readable):** [`docs/vault/clinical/case-history.md`](../docs/vault/clinical/case-history.md) — chief complaint · vitals · ICD-10 · diagnosis · drug list · escalation per case.

All 15 cases are explicitly fictional, authored by Simranjot Kaur for
this project, and synthetically constructed against the SRH clinical
handbook standard. **No real PHI in any case.**

The reviewer running a fresh clone will see all 15 cases on the
`/app/case-library → Demo` tab as soon as they sign in.
