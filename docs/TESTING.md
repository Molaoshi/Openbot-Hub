# Testing OpenBot Hub

## What is implemented

The repository contains a runnable, account-free vertical slice:

- A global Army room and member-scoped project rooms.
- A persistent agent registry with add, edit, disable, re-enable, and remove controls.
- Local and authenticated remote-ACP agent execution.
- Deterministic offline agents with durable sessions.
- Live updates over server-sent events.
- Node identity on every agent reply.
- Remote workspace selection and execution-proof files.
- Idempotent client message posting.
- Persistent per-recipient execution records with lifecycle history and result links.
- Execution cards with queued/active stop and known-safe retry controls.
- Connectivity checks with available, unavailable, misconfigured, disabled, and untested health.
- Room rename, purpose/membership editing, and confirmed deletion in the UI and API.
- Deterministic slow and fail-once fake work for supervision acceptance.
- Offline connector and application integration tests.

No upstream OpenBot installation, email address, vendor account, API key, model provider, or paid API call is required.

## Run automated checks

```sh
cd /Users/immortalist/Documents/Kimi/Workspaces/MacServer/openbot-hub
npm run check
npm test
npm run test:ui  # requires macOS and Google Chrome
```

The browser command starts an isolated temporary server on a random port, uses separate runtime state, exercises real desktop and phone-width interactions, writes screenshots and a report under `artifacts/ui-validation/`, and stops its temporary processes. It does not replace the persistent service or modify its state.

The integration tests verify:

- ACP initialization, prompt responses, and execution in the node workspace.
- Durable session reload after a proxy restart.
- Rejection of an invalid connector credential.
- Account-free health and room state APIs.
- Replies from both `mac-mini` and `demo-dell` agents.
- Exactly two agent replies to the initial Army-room `@everyone` request.
- Project-room membership and room-scoped `@everyone` routing before and after membership replacement.
- Room rename and purpose editing, duplicate-name and length validation, and Army update/delete protections.
- Confirmed disposable-room deletion with message, execution, and idempotency-receipt cleanup.
- Persisted queued → running → completed execution history and reply-message links.
- Available, unavailable, misconfigured, disabled, and untested connectivity health.
- Five concurrent posts with one idempotency key producing one message and one execution.
- Per-agent queue ordering, including work that remains queued behind a slow turn.
- Queued and active stop with no stopped reply, resource cleanup, and successful subsequent work.
- One known-safe fail-once retry with attempt linkage; interrupted and unknown outcomes cannot be retried.
- Non-global room deletion blocked while its execution is active.
- Unfinished executions recovered as `unknown` after restart without automatic reruns or extra messages.
- Agent creation, renaming, disabling, re-enabling, session resume, and removal.
- Preservation of message history after agent removal.
- Duplicate-name rejection and unknown-room/member validation.
- No duplicate message or execution when a `clientMessageId` is repeated.
- Registry, room, conversation, execution, and session persistence after an application restart.

## Run the app

```sh
cd /Users/immortalist/Documents/Kimi/Workspaces/MacServer/openbot-hub
npm run dev -- --host 127.0.0.1 --port 7100
```

Open `http://127.0.0.1:7100/`. Stop the app with Ctrl+C when finished.

The launcher creates demo-only state under `runtime/`, generates a local connector credential if needed, starts the fake execution node, and then starts the web application. It never launches upstream OpenBot or touches Army Hub.

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

Execution evidence is written beneath the agent's configured workspace. Initial demo paths include:

```text
runtime/hub/mini-workspace/
runtime/demo/dell-workspace/dell-fake/
```

Each workspace contains `execution-proof.json`, `last-prompt.txt`, and `events.jsonl` after execution.

## Current limitations

- The node named `demo-dell` runs on the current Mac. It proves transport and execution separation, not execution on the physical Dell.
- The available adapters are deterministic fake harnesses; DSH, OpenCode, Hermes, and Grok adapters are not implemented.
- Waiting/question states, reusable teams, agent-to-agent delegation, approvals, attachments, rich tool-call rendering, and remote tool arbitration are not implemented.
- Safe retry is limited to explicit pre-execution failures; interrupted and unknown outcomes require reconciliation rather than automatic resubmission.
- The server is loopback-only by default and has no network user authentication. Tailscale/phone exposure requires an access-control design first.
- This is a development proof of concept, not a production-hardened deployment.
