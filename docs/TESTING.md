# Testing OpenBot Hub

## What is implemented

The repository contains a runnable, account-free application with:

- A global Army room and member-scoped project rooms.
- A persistent agent registry with add, edit, disable, re-enable, and remove controls.
- Deterministic local-fake and authenticated remote-ACP execution.
- A real local OpenCode ACP adapter with configurable CLI and workspace paths, native file tools, and durable native sessions.
- Live updates over server-sent events.
- Node identity on every agent reply.
- Workspace selection and execution-proof evidence.
- Idempotent client message posting.
- Persistent per-recipient execution records with lifecycle history and result links.
- Execution cards with queued/active stop and known-safe retry controls.
- Connectivity checks with available, unavailable, misconfigured, disabled, and untested health.
- Room rename, purpose/membership editing, and confirmed deletion in the UI and API.
- Deterministic slow and fail-once fake work for supervision acceptance.
- Offline connector/application integration tests and a separate live OpenCode acceptance script.

The offline demo and test suite require no upstream OpenBot installation, email address, vendor account, API key, model provider, or paid API call. The optional real OpenCode test uses the CLI's existing provider authentication and makes two small model calls; it does not use an OpenBot account or copy provider credentials into the Hub.

## Run automated checks

```sh
cd /Users/immortalist/Documents/Kimi/Workspaces/MacServer/openbot-hub
npm run check
npm test
npm run test:ui  # requires macOS and Google Chrome
npm run test:opencode  # separate live gate; uses existing OpenCode provider auth
```

The browser command starts an isolated temporary server on a random port, uses separate runtime state, exercises real desktop and phone-width interactions, writes screenshots and a report under `artifacts/ui-validation/`, and stops its temporary processes. It does not replace the persistent service or modify its state. GitHub Actions runs `npm run check` and `npm test` for every pull request and push to `main`; browser and live provider tests remain local acceptance gates.

The integration tests verify:

- ACP initialization, prompt responses, and execution in the node workspace.
- Durable session reload after a proxy restart.
- Rejection of an invalid connector credential.
- Account-free health and room state APIs.
- Replies from both `mac-mini` and `demo-dell` agents.
- Project-room membership and room-scoped `@everyone` routing before and after membership replacement.
- Room rename and purpose editing, duplicate-name and length validation, and Army update/delete protections.
- Confirmed disposable-room deletion with message, execution, and idempotency-receipt cleanup.
- Persisted queued → running → completed execution history and reply-message links.
- Available, unavailable, misconfigured, disabled, and untested connectivity health.
- Explicit, unique OpenCode workspaces and non-secret registration/configuration preservation.
- Two nonexistent-CLI connectivity attempts returning `misconfigured` without terminating the Hub.
- Foreign Origin and Host headers rejected before execution, non-JSON mutations rejected, and same-origin JSON work still accepted.
- Malformed state aborting startup while leaving the original bytes unchanged; valid state creates a load backup before recovery writes.
- Fake provider secrets in stderr redacted from health, execution errors, room messages, and persisted state.
- Five concurrent posts with one idempotency key producing one message and one execution.
- Per-agent queue ordering, including work that remains queued behind a slow turn.
- Queued and active fake stop with no stopped reply, resource cleanup, and successful subsequent work; real OpenCode stop/failure supervision remains incomplete.
- One known-safe fail-once retry with attempt linkage; interrupted and unknown outcomes cannot be retried.
- Non-global room deletion blocked while its execution is active.
- Unfinished executions recovered as `unknown` after restart without automatic reruns or extra messages.
- Agent creation, renaming, disabling, re-enabling, session resume, and removal.
- Preservation of message history after agent removal.
- Duplicate-name rejection and unknown-room/member validation.
- No duplicate message or execution when a `clientMessageId` is repeated.
- Registry, room, conversation, execution, and session persistence after an application restart.

## Real OpenCode acceptance

Run `npm run test:opencode`. Set `OPENCODE_CLI=/full/path/to/opencode-cli` when the installed CLI differs from this Mac's default `~/Library/Application Support/ai.opencode.desktop/cli/2.0.26/opencode-cli`.

The script creates an isolated root under ignored `.runtime/`, starts the actual Hub API with one `local-opencode` agent, and verifies:

1. Connectivity through real ACP initialization.
2. A small live task creates `evidence.txt` with an exact random token and no additional workspace files.
3. The reply and execution retain Army-room, origin, agent, and `mac-mini` identity with queued → running → completed history.
4. No unexpected task artifacts appear in the control directory outside the disposable workspace, and an outside guard file remains unchanged.
5. The registry definition contains no provider credential fields.
6. After a full Hub restart, OpenCode loads the same native session and recalls the token without rereading the file.
7. Temporary app processes stop and the disposable acceptance root is removed.

The JSON report is written to `artifacts/opencode-acceptance/report.json`. This evidence covers task artifacts inside the isolated acceptance root. It is not an operating-system sandbox and does not prohibit OpenCode's own provider profile or native session storage elsewhere.

## Run the app

```sh
cd /Users/immortalist/Documents/Kimi/Workspaces/MacServer/openbot-hub
npm run dev -- --host 127.0.0.1 --port 7100
```

Open `http://127.0.0.1:7100/`. Stop the app with Ctrl+C when finished.

The launcher creates demo-only state under `runtime/`, generates a local connector credential if needed, starts the fake execution node, and then starts the web application. It never launches upstream OpenBot or touches Army Hub. Real OpenCode agents are registered separately through the execution directory and launch only when tested or addressed.

## Manual acceptance flow

### Chat

1. Confirm the page shows the **Army** room and two initial agents, with no sign-in or onboarding.
2. Send `@Mini Fake hello` and expect a reply tagged `MAC-MINI`.
3. Send `@Dell Fake hello` and expect a reply tagged `DEMO-DELL`.
4. Send `@everyone status` and expect one reply from each enabled agent.

### Agent registry

1. Select **TEST** beside Mini Fake and confirm its health becomes **AVAILABLE**.
2. Select **+ ADD**, create a local-fake agent, and confirm it appears in the directory and Army mention chips.
3. Mention the new agent and confirm its reply and node identity.
4. Edit its name and color, disable it, and confirm it cannot be addressed for execution and shows **DISABLED**.
5. Re-enable it and send another message; its saved session should resume.
6. Remove it and confirm its previous messages remain in the conversation.
7. Restart the app and confirm registry changes persist.
8. Open **+ ADD**, choose **OpenCode · real ACP**, and confirm only the CLI path and OpenCode workspace are additionally required. Use a full CLI path and a disposable workspace for a real agent.

### Execution supervision

1. Send `@Mini Fake slow:5000 test stop`; its execution card should become **RUNNING**.
2. Send another Mini prompt while the slow turn is active; the second card should remain **QUEUED**. Stop it and confirm it becomes **INTERRUPTED** without a reply.
3. Stop the active slow turn, confirm it becomes **INTERRUPTED**, then send a normal prompt and confirm the agent still executes.
4. Send `@Mini Fake fail-once safe retry`. The first attempt should fail before execution and offer **Safe retry**.
5. Select **Safe retry** and confirm a linked attempt 2 completes. The old retry button should disappear; interrupted or unknown records never offer retry.

### Rooms and phone

1. Select **+ NEW**, create a room with only one agent member, and confirm it becomes active.
2. Send `@everyone status`; only the enabled room member should execute.
3. Use the header pencil to rename the room, edit its purpose, and change membership; confirm the mention chips update.
4. Reopen the room editor and delete the room with confirmation. Confirm the app returns to Army and the room history is removed.
5. Open Army's editor and confirm its name and membership are locked and deletion is unavailable; its purpose remains editable.
6. Switch between Army and a project room and confirm their transcripts remain separate.
7. At a narrow viewport, open and close the room and agent drawers.
8. Open the agent form at phone width and confirm its fields and actions fit the viewport.

Fake execution evidence is written beneath the agent's configured workspace. Initial demo paths include:

```text
runtime/hub/mini-workspace/
runtime/demo/dell-workspace/dell-fake/
```

Each fake workspace contains `execution-proof.json`, `last-prompt.txt`, and `events.jsonl` after execution. Real OpenCode evidence consists of native task artifacts in its configured workspace plus the Hub's durable execution and session records.

## Current limitations

- The node named `demo-dell` runs on the current Mac. It proves transport and execution separation, not execution on the physical Dell.
- OpenCode is the only real adapter. DSH, Hermes, and Grok adapters are not implemented.
- Waiting/question states, reusable teams, agent-to-agent delegation, approvals, attachments, generated-file return, rich tool-call rendering, and remote tool arbitration are not implemented.
- Safe retry is limited to explicit pre-execution failures; interrupted and unknown outcomes require reconciliation rather than automatic resubmission. Real OpenCode cancellation, descendant cleanup, provider failure, and post-interruption recovery are not yet proven.
- OpenCode workspace acceptance is not an OS-level sandbox. Broader permission mediation and containment remain security work.
- The remote-ACP demo uses authenticated raw TCP on loopback. Physical-machine deployment requires protected Tailscale transport or TLS and explicit binding rules in M4.
- The server is loopback-only by default and has no network user authentication. Tailscale/phone exposure requires an access-control design first.
- This is a development proof of concept, not a production-hardened deployment.
