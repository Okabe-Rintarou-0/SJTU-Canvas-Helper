# Account/session integration onto upstream a6f9f0b

This candidate integrates upstream a6f9f0bfd0aadd6b34d619859645ade771672d0c with the account/session branch. It retains token-to-Canvas-session/LTI authentication, categorized download layouts and legacy lookup, persistent AI artifacts, and the existing immutable owner/session boundaries.

## Additional boundary repairs

- Transcription resolves all candidate angles and processes audio with one immutable session client. Stale completion is rejected; local artifact writes are serialized with owner transitions.
- Proofreading captures its configured LLM snapshot, options, generation and logical account under the owner lock. Waiting on a work mutex cannot switch it to another account's credentials.
- Successful credential rotations clear shared AI caches and invalidate pending proofreads before publishing a new owner; ordinary settings preserve generation.
- Proofread save/reset and final result publication are owner-checked. Application-data persistence uses the validated ConfigStore, including isolated test stores.
- Color input events respect the owner guard. Single-track download and reopening retain course, owner, path and operation identity.

## Local verification, 2026-10-31

- Frontend: 55 files, 336 tests passed; TypeScript passed; changed test files' ESLint passed.
- Production build passed using a 4 GiB Node heap. The default 2 GiB run exhausted its heap; existing large-chunk and react-virtualized export warnings remain.
- Rust 1.99.0: check --tests passed; workspace tests 189 passed, 0 failed, 18 ignored; Clippy --workspace --all-targets --all-features with -D warnings passed.
- Added isolated stale-write/owner-lock/transcript persistence regressions. The local mock-server proofread test also verifies captured LLM state after mutable credentials are cleared.
- Port validation cases were split by invalid value without increasing timeouts or dropping rejection/correction assertions. Hook tests isolate an unrelated, never-mounted document preview dependency.

No live SJTU/JBox account, real audio transcription or paid model was exercised. Ignored tests are not acceptance evidence. Already-issued external work cannot be rolled back by a stale-result check. This is not a claim of whole-repository audit or real-device end-to-end acceptance.

## Upstream refresh, 2026-11-01

The refreshed candidate integrates ff03ee9b0a0bc825a4784478be08e66711422e69 (3.0.14), preserving the upstream canonical temporary-directory fixture and release workflow repairs. Frontend: 55 files / 336 tests passed; direct TypeScript check and emission passed. The npm typecheck wrapper initially could not find the existing TypeScript binary because the reused dependency directory lacks its .bin/tsc link; invoking that same installed binary directly succeeded. The first 4 GiB Vite build was killed with exit 137 while Rust was compiling; an isolated retry with the same heap limit passed. Existing large-chunk, react-virtualized export and pdf.js eval warnings remain.

Rust 1.99.0 offline/locked checks passed: check --tests, 189 workspace tests (18 ignored), and workspace/all-targets/all-features Clippy with -D warnings. Build-generated Linux permission schema changes were saved separately and excluded from the source patch. No live account, paid model, recording or real-device UI was exercised. These results do not establish remote CI or publication.
