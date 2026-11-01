# OpenBot Hub architecture

## Decision

OpenBot Hub is a custom, account-free application hosted on the Mac mini. It provides one responsive web interface and one global Army room; execution is distributed to agents on their assigned machines.

Upstream OpenBot is an architectural reference, not a runtime dependency. The application does not require OpenBot installation, email verification, vendor accounts, hosted services, billing, reporting, analytics, or telemetry. Useful protocol ideas and modules may be adopted selectively, with upstream notices preserved whenever code is copied or modified.

This deliberately avoids:

- Element, Matrix, or a second chat application.
- A separate control plane and host-specific room on every machine.
- Blindly running remote agents on the Mac mini.

Army Hub remains a separate, untouched repository and runtime.

## Current topology

```text
                    Desktop or phone browser
                              │
                              ▼
              Mac mini: OpenBot Hub web application
              ┌───────────────────────────────────┐
              │ One global Army room              │
              │ Agent directory and durable state │
              │ Per-agent queues and live updates │
              └───────────────┬───────────────────┘
                              │
                    Local ACP │ Remote ACP connector
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       Mini-local harness             Execution-node server
       and workspace                  on Dell / MacBook / future node
                                      ┌─────────┴─────────┐
                                      ▼                   ▼
                                Native harness      Node workspace
                                and sessions        and durable state
```

The current demo implements both paths on the Mac mini. Its `demo-dell` node proves transport and workspace separation, not execution on a physical Dell.

## Ownership

### Central OpenBot Hub application

Owns:

- The global Army room, project rooms, shared transcripts, and agent directory.
- Persistent agent definitions and references to their harness sessions.
- Per-agent execution queues.
- Direct mentions, room-scoped `@everyone`, idempotent user-post receipts, and a six-turn request limit.
- Live browser updates over server-sent events.
- Host-independent agent addressing.

It does not yet own approvals, attachment replication, autonomous delegation, reusable teams, or project-room editing/deletion.

### Execution-node connector

Owns:

- Authenticated connector handshakes.
- Translation between central ACP requests and the node-local harness.
- Node-specific workspace and state roots.
- Durable harness sessions and execution-location evidence.

It must not:

- Expose an unauthenticated ACP listener.
- Put credentials in prompts, logs, registry files, or Git.
- Silently execute a remote agent's work on the Mini.
- Blindly retry a turn whose execution outcome is unknown.

### Harness on each machine

Owns its native provider authentication, tools, workspace behavior, and local project memory. Real harness adapters are future work; the current harness is deterministic and offline.

## Agent and room configuration

The built-in demo seeds two agents on first run. After that, the persistent registry in the Hub state file is authoritative; the UI can create, edit, disable, re-enable, and remove definitions. The server also accepts `--agents <json-file>` to seed isolated test instances. Secrets must never be stored in the registry or committed.

Each agent maps:

```text
Hub agent ID ↔ execution node ID ↔ harness session ID ↔ workspace
```

Local-fake agents define `workspace` and `state`; remote-ACP agents reference a connector config containing node address, agent ID, and a local token-file reference. Editing execution configuration stops the old connector and resets its session reference; editing only presentation or enabled state preserves it. Removing an agent deletes its registry membership but not its historical messages.

The Army room is global and always addresses every enabled agent. Project rooms persist explicit member lists. Removing an agent also removes its project-room memberships.

## Message and session flow

1. Mo posts in the selected room with a client message ID.
2. Hub stores the message and its idempotency receipt before starting execution.
3. Leading mentions select enabled room members; `@everyone` selects all enabled members in that room.
4. Each selected agent enters its own serial queue.
5. The runtime creates or resumes the agent's durable ACP session.
6. Local agents execute directly; remote agents pass through the authenticated node connector.
7. Replies return to the originating room with author, origin, and execution-node identity.
8. Saved session IDs are reused after application restart.

A repeated client message ID returns the original receipt and starts no new execution. Automatic recovery of an interrupted active turn is not yet implemented and must not be assumed safe.

## Workspace and tool rules

A central path must never be passed blindly to a remote machine. Each remote agent has an explicit node-local workspace root. Execution-proof files record the node ID, hostname, process, session, and actual workspace.

Future attachments require deliberate transfer, size limits, and hash verification. Future remote tools require explicit execution-location and authorization tests; central browser or computer-use tools must never be presented as remote-machine tools.

## Security and deployment

- The web server listens on `127.0.0.1` by default.
- Connector credentials are generated locally, stored with owner-only permissions, and excluded from Git.
- Tailscale provides reachability, not application authorization. Secure phone access still needs an authenticated access design before binding the web server to a non-loopback interface.
- No vendor hosted server is required.
- Payment, billing, user reporting, product analytics, and telemetry are outside the product.

## Implementation status

Implemented and tested:

- Account-free responsive Army and project rooms.
- Persistent agent lifecycle management with history-preserving removal.
- Local and remote-ACP fake agents.
- Durable sessions and state.
- Node-tagged replies and execution evidence.
- Room-scoped `@everyone`, duplicate-post suppression, and restart recovery.
- Desktop and 390 px mobile chat, drawer, and management-form acceptance.

Not yet implemented:

- Project-room editing/deletion and reusable teams.
- Physical Dell and MacBook enrollment.
- Real DSH, OpenCode, Hermes, or Grok adapters.
- Approvals, attachments, rich tool rendering, and autonomous delegation.
- Network user authentication and production hardening.
