# Requirements traceability matrix

This is the implementation and acceptance index for `docs/product-requirements.md`. Update it whenever requirement status or evidence changes.

## Evidence commands

- **CHECK:** `npm run check` — JavaScript syntax validation.
- **APP:** `node --test tests/hub-app.test.mjs` — registry, rooms, API routing, idempotency, and restart integration.
- **ACP:** `node --test tests/remote-acp.test.mjs` — connector execution, workspace proof, resume, and credential rejection.
- **SUP:** `node --test tests/supervision.test.mjs` — connectivity, concurrent idempotency, queue ordering, stop, safe retry, and active-deletion safeguards.
- **UI:** `npm run test:ui` — isolated Chrome desktop and 390 px phone acceptance; artifacts are written under ignored `artifacts/ui-validation/`.
- **SVC:** `launchctl print gui/$(id -u)/com.molaoshi.openbot-hub` plus health/state checks and an intentional `kickstart -k` restart.

`npm test` runs APP, ACP, and SUP. UI requires macOS and Google Chrome. Future physical-phone, Dell, MacBook, security, and backup gates require their own recorded evidence; local simulation is not a substitute.

## Status summary

- **M0:** Local foundation; mostly complete, with broader requirements still partial.
- **M1:** Complete; supervision and room exit gate passed on 2026-11-02.
- **M2:** Next milestone; real harness and file work has not started.
- **M3–M5:** Planned; see `docs/migration-plan.md`.
- No P0/P1 requirement may be called Done from implementation alone; the evidence column must actually pass.

## Core application and state

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| CORE-01 | M0 | Done | APP checks `accounts:false` and no external analytics flag; UI loads the complete app without sign-in or upstream OpenBot. |
| CORE-02 | M0 | Done | SVC verified running under launchd and automatically recovered after an intentional restart on 2026-11-02. |
| CORE-03 | M5 | Partial | APP proves JSON state, fake-session restart, persisted execution records, and unfinished-to-unknown recovery; backup/restore remains. |

## Rooms and conversation

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| ROOM-01 | M0 | Done | APP verifies the global Army room and both initial agents; UI addresses agents without host switching. |
| ROOM-02 | M0 | Done | APP creates a member-scoped room and persists it; UI creates, selects, and displays separate transcripts. |
| ROOM-03 | M1 | Done | APP and UI cover rename, purpose/membership editing, confirmed deletion with history/receipt cleanup, active-work deletion blocking, and Army protections. |
| ROOM-04 | M0 | Done | APP proves Army and project-room `@everyone` routing, disabled-agent exclusion, and origin room IDs. |

## Agent and harness management

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| AGENT-01 | M0 | Done | APP and UI cover add, rename, disable, re-enable, resume, removal, duplicate-name rejection, and history preservation. |
| AGENT-02 | M2 | Partial | APP/ACP prove a common runtime over local-fake and remote-ACP; a real harness must pass the same boundary tests. |
| AGENT-03 | M1 | Done | SUP verifies available, unavailable, misconfigured, disabled, and session/unknown transitions; UI runs connectivity checks and displays health. |
| AGENT-04 | M2 | Planned | Run a real DSH or OpenCode agent in a disposable workspace; verify prompt, tools, session resume, failures, and credential isolation. |

## Execution supervision and reliability

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| EXEC-01 | M1 | Done | SUP proves concurrent duplicate-post suppression, per-agent queued/running order, and ordered replies; APP retains single-post idempotency coverage. |
| EXEC-02 | M1 | Done | APP/SUP verify persisted queued/running/completed/failed/interrupted/unknown histories and result links; UI exposes applicable states without false success. Waiting is reserved for M2 approvals. |
| EXEC-03 | M1 | Done | SUP stops queued and active fake turns, proves no stopped reply, resource cleanup, and subsequent execution; UI stops a slow active turn. |
| EXEC-04 | M1 | Done | APP/SUP prove unknown recovery without reruns, rejected unknown/interrupted retries, one known-safe fail-once retry, and completed attempt-two linking; UI exercises safe retry. |
| EXEC-05 | M2 | Planned | Script question/approval round trips, wrong-session rejection, expiry, stop, and terminal-state persistence. |
| EXEC-06 | M2 | Planned | Display realistic tool/progress events and verify node attribution and failure rendering in APP/UI. |
| EXEC-07 | M2 | Partial | ACP proves fake node/workspace/hostname evidence; repeat on every real adapter and physical node. |

## Teams and coordination

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| TEAM-01 | M3 | Planned | Create/edit/delete a team and verify team mentions reach only enabled members. |
| TEAM-02 | M3 | Planned | Scripted cross-agent delegation must preserve origin, room, node, routing, and depth limits. |
| TEAM-03 | M3 | Planned | Shared task state and synthesized results must survive restart and appear once in the originating room. |
| TEAM-04 | M3 | Planned | Force a cross-node delegation chain and prove the global budget stops it without transport-event consumption. |

## Files

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| FILE-01 | M2 | Planned | Verify content/hash, limits, traversal rejection, interrupted transfer, and retry-safe attachment handling. |
| FILE-02 | M2 | Planned | Return and preview generated files across local and remote paths with size/hash verification. |

## Execution nodes

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| NODE-01 | M0 | Done | ACP proves authenticated round trip and invalid-credential rejection before harness startup. |
| NODE-02 | M4 | Planned | Run host-specific sentinel and workspace tests on the physical Dell; no Mini execution fallback. |
| NODE-03 | M4 | Planned | Repeat identity, session, workspace, and reconnect acceptance on MacBook and one future-node configuration. |
| NODE-04 | M4 | Partial | ACP proves selected remote workspace and no central proof files; traversal, absolute-path, and symlink escapes remain. |

## Phone experience

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| MOBILE-01 | M0 | Done | UI passes 390 px chat, room/agent drawers, mentions, management forms, and horizontal-overflow checks. |
| MOBILE-02 | M4 | Planned | Physical phone opens the same room over authenticated private connectivity; no vendor account or second chat app. |
| MOBILE-03 | M4 | Planned | Install, background/foreground, switch Wi-Fi/cellular, and reconnect without duplicate messages or turns. |

## Security and operations

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| SEC-01 | M5 | Partial | Current server defaults to loopback and the app contains no commerce/analytics flows; complete actual egress and permission review. |
| SEC-02 | M4 | Planned | Unauthenticated/wrong-identity requests fail before any non-loopback exposure; authorized phone access succeeds. |
| SEC-03 | M5 | Partial | Demo tokens use separate owner-only files and are Git-ignored; audit storage, logs, rotation, and provider-secret isolation. |
| OPS-01 | M0 | Done | SVC restart recovered health and preserved one room, two agents, and six existing messages on 2026-11-02. |
| OPS-02 | M5 | Planned | Back up and restore Hub, sessions, registry, and node configuration into an isolated acceptance instance. |
| OPS-03 | M5 | Planned | Rotate/revoke credentials and remove a node without unauthorized access or unrelated-agent disruption. |
| OPS-04 | M5 | Planned | Inventory egress and permissions; verify blocked optional destinations do not break accepted workflows. |

## Follow-on requirements

| ID | Milestone | Status | Acceptance evidence |
|---|---|---|---|
| EXP-01 | Post-V1 | Planned | Prioritize only after observed daily-use needs; define search/notification acceptance separately. |
| EXP-02 | Post-V1 | Planned | Schedule only after execution recovery and duplicate-prevention gates pass. |

## Current release conclusion

OpenBot Hub is a verified local proof of concept with M1 supervision complete, not full-feature V1. M2 is the next milestone and has not started. Physical devices, real harnesses, and production readiness must not be inferred from fake-agent or phone-sized-browser evidence.
