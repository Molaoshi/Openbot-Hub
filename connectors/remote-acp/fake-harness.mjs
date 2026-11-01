import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { textFromPrompt } from "./lib.mjs";

const nodeId = process.env.OPENBOT_HUB_NODE_ID ?? "unknown-node";
const title = process.env.OPENBOT_HUB_AGENT_TITLE ?? "Fake Agent";
const workspace = process.env.OPENBOT_HUB_WORKSPACE;
const stateRoot = process.env.OPENBOT_HUB_STATE_ROOT;
if (!workspace || !stateRoot) throw new Error("OPENBOT_HUB_WORKSPACE and OPENBOT_HUB_STATE_ROOT are required.");
mkdirSync(workspace, { recursive: true });
mkdirSync(stateRoot, { recursive: true });

const models = {
  availableModels: [{ modelId: "offline-demo", name: "Offline demo (no API calls)" }],
  currentModelId: "offline-demo",
};
const sessionPath = (id) => join(stateRoot, `${id}.json`);
const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const reply = (request, result) => write({ id: request.id, result });
const fail = (request, code, message) => write({ id: request.id, error: { code, message } });
const update = (sessionId, value) => write({ method: "session/update", params: { sessionId, update: value } });
const say = (sessionId, text) => update(sessionId, {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

function loadSession(id) {
  try {
    return JSON.parse(readFileSync(sessionPath(id), "utf8"));
  } catch {
    return null;
  }
}

function saveSession(session) {
  const path = sessionPath(session.id);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function record(session, sessionUpdate, text) {
  session.history.push({ sessionUpdate, text });
  saveSession(session);
}

const handlers = {
  initialize(request) {
    reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "openbot-hub-fake", title, version: "0.1.0" },
      agentCapabilities: { loadSession: true },
      authMethods: [],
    });
  },
  "session/new"(request) {
    const session = { id: randomUUID(), nodeId, workspace, history: [] };
    saveSession(session);
    reply(request, { sessionId: session.id, models });
  },
  "session/load"(request) {
    const session = loadSession(request.params.sessionId);
    if (!session) return fail(request, -32002, "Resource not found");
    for (const item of session.history) {
      update(session.id, {
        sessionUpdate: item.sessionUpdate,
        content: { type: "text", text: item.text },
      });
    }
    reply(request, { sessionId: session.id, models });
  },
  "session/resume"(request) {
    const session = loadSession(request.params.sessionId);
    if (!session) return fail(request, -32002, "Resource not found");
    reply(request, { sessionId: session.id, models });
  },
  "session/prompt"(request) {
    const session = loadSession(request.params.sessionId);
    if (!session) return fail(request, -32002, "Resource not found");
    const text = textFromPrompt(request.params.prompt);
    session.simulatedFailures ??= [];
    if (text.includes("fail-once") && !session.simulatedFailures.includes(text)) {
      session.simulatedFailures.push(text);
      saveSession(session);
      return fail(request, -32010, "Simulated pre-execution failure; safe to retry.");
    }
    record(session, "user_message_chunk", text);
    writeFileSync(join(workspace, "last-prompt.txt"), `${text}\n`);
    writeFileSync(join(workspace, "execution-proof.json"), `${JSON.stringify({
      nodeId,
      hostname: hostname(),
      pid: process.pid,
      sessionId: session.id,
      workspace,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    appendFileSync(join(workspace, "events.jsonl"), `${JSON.stringify({
      event: "prompt",
      nodeId,
      sessionId: session.id,
      at: new Date().toISOString(),
    })}\n`);
    const answer = [
      `${title} is online.`,
      `Execution node: ${nodeId}`,
      `Machine hostname: ${hostname()}`,
      `Workspace: ${workspace}`,
      `Received: ${text || "(empty prompt)"}`,
      "This is a deterministic offline response; no model or paid API call was made.",
    ].join("\n");
    const finish = () => {
      say(session.id, answer);
      record(session, "agent_message_chunk", answer);
      reply(request, { stopReason: "end_turn" });
    };
    const delay = Number(text.match(/\bslow:(\d+)\b/)?.[1] ?? 0);
    if (delay > 0) setTimeout(finish, Math.min(delay, 30_000));
    else finish();
  },
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    if (request.id === undefined || typeof request.method !== "string") continue;
    const handler = handlers[request.method];
    if (handler) handler(request);
    else reply(request, {});
  }
});
setInterval(() => {}, 1000);
