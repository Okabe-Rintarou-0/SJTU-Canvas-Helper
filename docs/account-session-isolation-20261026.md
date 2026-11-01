# Canvas SSO/media session isolation candidate (2026-10-26)

## Contract and implementation

- `App::canvas_session` caches one `Arc<CanvasSession>` by trusted configuration owner generation, not account name. It constructs the existing `canvas_read_snapshot` client: new Jar, new JWT lock, fixed origin; only diagnostics are shared.
- Cache lookup uses owner → config → session-slot lock order. These locks are all released before HTTP. An old task retains only its old session/client; a late `Set-Cookie` or JWT write never targets the newly selected session.
- Existing owner rotation is authoritative: account switches (including A→B→A) create new generations; bearer token, account type, JA cookie, legacy video cookies/key and JBox credentials rotate on save. Ordinary settings keep their owner and session. No second credential-key scheme is introduced.
- New generations lazily authenticate against Canvas using their captured JA cookie. A per-session single-flight mutex preserves login state for same-owner calls, retries after failure/cancellation, and avoids losing normal login capability after derived credential saves rotate the owner. It is not an account-transition/cache lock.
- Canvas/video-space/live/legacy browsing and info, subtitle/PPT, and recording-material batches use this session. Each result is checked against its owner; recording batches retain one session throughout rather than obtaining another account's client halfway through.
- QR bootstrap is a separate, one-slot latest-attempt cache. `get_uuid` allocates a fresh private client; `express_login` retrieves exactly that UUID's client. Attempt ID plus owner checks reject late UUID/cookie returns after a new attempt, credential revision or account switch. Empty initial credentials are permitted as long as the configuration store has a valid owner. Repeated polling on the same attempt is supported. Failed/cancelled UUID requests can be replaced by a new attempt.
- A 30-second budget wraps QR requests, Canvas SSO preparation/status, legacy login and legacy authorization-key lookup. This is a flow-level cancellation boundary, not a blanket download-client timeout. Existing redirect/cookie-scope policies are unchanged.

## Tests added (Rust execution pending)

Five tests in `app::session::tests` use temporary ConfigStore data, synthetic credentials, and loopback only:

1. Same-owner reuse after ordinary settings; independent Jar/JWT after credential revisions.
2. Block real HTTP Set-Cookie/JWT delivery, switch A→B→A through the real account transaction API, then release: old return and configuration writeback rejected; B/new-A Jar/JWT remain empty. Switching is bounded independently while old authentication is blocked.
3. Cold login failure/cancellation is retryable; successful concurrent preparation runs login once.
4. Empty-credential initial QR attempt, failed UUID retry, superseded UUID rejection, repeated polling completion, credential-owner revision rejection.
5. Block old QR attempt's HTTP response, start a new attempt, then release: old return rejected, new attempt and account session remain clean.

The loopback test helper uses the real session Jar/JWT lock and an explicitly no-proxy transport so CI proxy settings cannot redirect synthetic fixture traffic externally. It does not contact or mock real Canvas/JBox credentials.

## Validation and limits

- `git diff --check`: passed.
- `node --test script/*.node-test.mjs`: 2 passed. These test only the existing Rust-check harness, **not Rust semantics or compilation**.
- No Cargo/rustc exists in this cloud environment. New Rust tests and final full Rust/Clippy gates must run in the already-authorized fork CI after root integration. No real-service login, user device, credential reading, model/paid calls, commit or push was performed here.
- This patch isolates the SSO/media paths described above. It intentionally does not rewrite all unrelated `app/basic.rs` bearer-token operations or LLM APIs. Existing per-read snapshots/ownership safeguards there are unchanged; no claim of universal HTTP isolation follows from this media change.
- Same-owner parallel course JWT replacement remains the pre-existing per-client semantics; this patch addresses account-generation isolation, not per-course JWT addressing.
- Existing file-download tasks remain bound to their captured client/destination; this patch does not introduce transactional rollback of local exported artifacts after account switches.
- The QR attempt slot is memory-bounded to one attempt; HTTP execution is time-bounded, but no new QR lifetime/expiry is imposed because the existing UI refreshes a UUID's websocket QR payload.
