# Recording JWT isolation within one account

This candidate starts from the source tree of upstream PR #139 at
`eeff8c60a41f65af5b993114addebe685fd7f943` (tree
`170bef299787e9ee7c8170b82ae12a9485bb0df1`). It is separate from the already
published account-switch/storage-panel repair.

## Remaining failure reproduced

A subtitle request read a mutable shared JWT on each HTTP call. While an
optimized subtitle response was pending, another course launch could replace
that JWT. The original-subtitle fallback then used the second course's
credential. A loopback HTTP regression fails on the previous implementation:
the original-subtitle endpoint receives the wrong credential and rejects it.

## Candidate behavior

- Course list results bind their returned recording IDs to the exact launch
  credential used to obtain that list. Course and live launches no longer
  replace the account-wide video-space JWT.
- Playback info, original/optimized subtitles, AI+ status and PPT look up a
  credential by recording ID. Optimized/original subtitle attempts and the
  parallel AI+ status query share a single captured credential.
- The recording cache is limited to 4,096 IDs. A batch shares one in-memory
  token allocation. Unknown/evicted IDs use the video-space credential, never
  another course's last-launched token. There is no credential persistence,
  serialization, logging, new external service or public IPC field.
- Credential reset and explicit classroom login refresh clear that cache and
  advance its generation. A previously started course-list request cannot
  repopulate it afterward. Successful playback refreshes publish under that
  version, so a late refresh cannot overwrite an explicit login. Explicit
  login/reset has a separate epoch: concurrent renewals in the same epoch still
  invalidate their own old bindings while preserving the newer global token.
  Sibling bindings sharing the old token are invalidated together; unrelated course
  bindings are retained. List-launch sequence numbers prevent an older response
  from replacing a newer recording binding, including after bounded eviction.
- Existing errors, request budgets and the single retry for an otherwise
  successful empty playback response are preserved. No HTTP error, malformed
  payload or mutation is automatically replayed.

## Acceptance boundaries

Local regression evidence uses synthetic credentials and loopback HTTP, not a
real SJTU account. It checks concurrent course lists, exact credentials on
subtitle/status/original/PPT requests, a delayed original-subtitle fallback,
cache bounds and invalidation. Playback's real-service fallback semantics,
real-device UI and live cross-course acceptance remain unverified.

This is not the requested custom/GPU ASR, audio-first parallel download or
subtitle-packaging pipeline. Those are separate, still unfinished work.
No new PR, merge, release, deployment, paid model or user device is involved.
