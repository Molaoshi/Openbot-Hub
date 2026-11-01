import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentRuntime } from "./agent-runtime.mjs";

const MAX_TURNS_PER_REQUEST = 6;
const COLORS = new Set(["yellow", "pink", "lavender"]);
const TRANSPORTS = new Set(["local-fake", "local-opencode", "remote-acp"]);
const EXECUTION_FIELDS = ["nodeId", "transport", "command", "workspace", "state", "config", "centralWorkspace"];
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, fallback = "") => typeof value === "string" ? value.trim() : fallback;

const defaultAgents = () => [
  {
    id: "mini-fake",
    name: "Mini Fake",
    nodeId: "mac-mini",
    transport: "local-fake",
    workspace: "runtime/hub/mini-workspace",
    state: "runtime/hub/mini-state",
    centralWorkspace: "runtime/hub/mini-central",
    color: "yellow",
    enabled: true,
  },
  {
    id: "dell-fake",
    name: "Dell Fake",
    nodeId: "demo-dell",
    transport: "remote-acp",
    config: "config/agent.demo.json",
    centralWorkspace: "runtime/hub/dell-central",
    color: "pink",
    enabled: true,
  },
];

const armyRoom = () => ({
  id: "army",
  name: "Army",
  purpose: "One room for every agent and every machine.",
  global: true,
  agentIds: [],
});

export class Hub {
  constructor({ root, statePath, agents = null }) {
    this.root = root;
    this.statePath = statePath;
    this.configuredAgents = agents;
    this.listeners = new Set();
    this.state = null;
    this.runtime = null;
    this.saveQueue = Promise.resolve();
  }

  async load() {
    let saved = null;
    try {
      saved = JSON.parse(await readFile(this.statePath, "utf8"));
    } catch {}
    const seededAgents = this.configuredAgents ?? defaultAgents();
    const definitions = saved?.agentDefinitions ?? seededAgents;
    const savedRooms = Array.isArray(saved?.rooms) && saved.rooms.length ? saved.rooms : [saved?.room ?? armyRoom()];
    const rooms = savedRooms.map((room) => ({
      ...room,
      global: room.id === "army" ? true : Boolean(room.global),
      agentIds: Array.isArray(room.agentIds) ? room.agentIds : [],
    }));
    if (!rooms.some((room) => room.id === "army")) rooms.unshift(armyRoom());
    const recoveredAt = new Date().toISOString();
    const executions = (saved?.executions ?? []).map((execution) => {
      if (!["queued", "running", "waiting"].includes(execution.status)) return execution;
      const error = "The hub restarted before this execution finished; its outcome is unknown and it was not rerun.";
      return {
        ...execution,
        status: "unknown",
        updatedAt: recoveredAt,
        endedAt: recoveredAt,
        error,
        history: [...(execution.history ?? []), { from: execution.status, to: "unknown", at: recoveredAt, error }],
      };
    });
    this.state = {
      version: 4,
      rooms,
      agentDefinitions: definitions.map((agent) => ({ ...agent, enabled: agent.enabled !== false })),
      agents: definitions.map((definition) => {
        const savedAgent = saved?.agents?.find((agent) => agent.id === definition.id);
        const health = savedAgent?.health?.status === "checking" ? null : savedAgent?.health;
        return {
          id: definition.id,
          sessionId: savedAgent?.sessionId ?? null,
          health: health ?? { status: definition.enabled === false ? "disabled" : "unknown", checkedAt: null, error: null },
        };
      }),
      messages: (saved?.messages ?? [{
        id: randomUUID(),
        roomId: "army",
        authorId: "system",
        authorType: "system",
        text: "Army room ready. Mention an agent or @everyone. No accounts, external APIs, or paid model calls are used in this demo.",
        createdAt: new Date().toISOString(),
      }]).map((message) => ({ ...message, roomId: message.roomId ?? "army" })),
      executions,
      receipts: saved?.receipts ?? {},
    };
    this.runtime = new AgentRuntime({
      root: this.root,
      agents: this.state.agentDefinitions,
      onSession: async (agentId, sessionId) => {
        const agent = this.state.agents.find((candidate) => candidate.id === agentId);
        if (!agent) return;
        agent.sessionId = sessionId;
        await this.save();
        this.emit("change");
      },
    });
    await mkdir(dirname(this.statePath), { recursive: true });
    await this.save();
  }

  snapshot() {
    return {
      rooms: this.state.rooms,
      agents: this.state.agentDefinitions.map((definition) => {
        const session = this.state.agents.find((agent) => agent.id === definition.id);
        return {
          ...definition,
          sessionReady: Boolean(session?.sessionId),
          health: session?.health ?? { status: definition.enabled ? "unknown" : "disabled", checkedAt: null, error: null },
        };
      }),
      messages: this.state.messages,
      executions: this.state.executions,
      limits: { maxTurnsPerRequest: MAX_TURNS_PER_REQUEST },
    };
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type) {
    for (const listener of this.listeners) listener(type);
  }

  save() {
    const operation = this.saveQueue.catch(() => {}).then(async () => {
      const temporary = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.statePath);
    });
    this.saveQueue = operation;
    return operation;
  }

  room(roomId) {
    const room = this.state.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw problem("Room not found.", 404);
    return room;
  }

  members(room) {
    return this.state.agentDefinitions.filter((agent) => agent.enabled && (room.global || room.agentIds.includes(agent.id)));
  }

  recipients(text, room) {
    const normalized = text.trimStart().toLowerCase();
    const members = this.members(room);
    if (normalized.startsWith("@everyone")) return members.map((agent) => agent.id);
    const selected = [];
    for (const agent of [...members].sort((a, b) => b.name.length - a.name.length)) {
      if (normalized.startsWith(`@${agent.name.toLowerCase()}`)) selected.push(agent.id);
    }
    return selected;
  }

  roomName(value, excludeId = null) {
    const name = clean(value);
    if (!name) throw problem("Room name is required.");
    if (name.length > 80) throw problem("Room name is too long.");
    if (this.state.rooms.some((room) => room.id !== excludeId && room.name.toLowerCase() === name.toLowerCase())) {
      throw problem("A room with that name already exists.", 409);
    }
    return name;
  }

  roomPurpose(value, fallback = "A focused room for coordinated work.") {
    const purpose = clean(value, fallback);
    if (purpose.length > 240) throw problem("Room purpose is too long.");
    return purpose;
  }

  roomMembers(agentIds) {
    if (!Array.isArray(agentIds)) throw problem("Room members must be an array.");
    const known = new Set(this.state.agentDefinitions.map((agent) => agent.id));
    const members = [...new Set(agentIds)];
    if (members.some((id) => typeof id !== "string" || !known.has(id))) throw problem("Room contains an unknown agent.");
    return members;
  }

  async createRoom({ name, purpose, agentIds }) {
    const room = {
      id: randomUUID(),
      name: this.roomName(name),
      purpose: this.roomPurpose(purpose),
      global: false,
      agentIds: this.roomMembers(agentIds),
    };
    this.state.rooms.push(room);
    this.state.messages.push({
      id: randomUUID(),
      roomId: room.id,
      authorId: "system",
      authorType: "system",
      text: `${room.name} is ready with ${room.agentIds.length} member${room.agentIds.length === 1 ? "" : "s"}.`,
      createdAt: new Date().toISOString(),
    });
    await this.save();
    this.emit("change");
    return room;
  }

  async updateRoom(roomId, input) {
    const room = this.room(roomId);
    if (room.global) {
      if (input.name !== undefined && clean(input.name) !== room.name) throw problem("The global room cannot be renamed.", 409);
      if (input.global !== undefined && input.global !== room.global) throw problem("The room's global status cannot be changed.", 409);
      if (input.agentIds !== undefined) throw problem("Global room membership cannot be changed.", 409);
    } else if (input.global !== undefined && input.global !== room.global) {
      throw problem("The room's global status cannot be changed.", 409);
    }
    const name = input.name === undefined ? room.name : this.roomName(input.name, room.id);
    const purpose = this.roomPurpose(input.purpose, room.purpose);
    const agentIds = input.agentIds === undefined ? room.agentIds : this.roomMembers(input.agentIds);
    Object.assign(room, { name, purpose, agentIds });
    await this.save();
    this.emit("change");
    return room;
  }

  async removeRoom(roomId, confirmation) {
    const room = this.room(roomId);
    if (room.global) throw problem("The global room cannot be deleted.", 409);
    if (confirmation !== "delete-history") throw problem("Room deletion requires delete-history confirmation.", 409);
    if (this.state.executions.some((execution) => execution.roomId === room.id && ["queued", "running", "waiting"].includes(execution.status))) {
      throw problem("Room deletion is blocked while work is active.", 409);
    }
    const deletedMessages = this.state.messages.filter((message) => message.roomId === room.id);
    const deletedMessageIds = new Set(deletedMessages.map((message) => message.id));
    const deletedExecutions = this.state.executions.filter((execution) => execution.roomId === room.id).length;
    this.state.rooms = this.state.rooms.filter((candidate) => candidate.id !== room.id);
    this.state.messages = this.state.messages.filter((message) => message.roomId !== room.id);
    this.state.executions = this.state.executions.filter((execution) => execution.roomId !== room.id);
    this.state.receipts = Object.fromEntries(Object.entries(this.state.receipts).filter(([, messageId]) => !deletedMessageIds.has(messageId)));
    await this.save();
    this.emit("change");
    return { removed: room.id, deletedMessages: deletedMessages.length, deletedExecutions };
  }

  normalizeAgent(input, existing = null) {
    const name = clean(input.name, existing?.name);
    const nodeId = clean(input.nodeId, existing?.nodeId);
    const transport = clean(input.transport, existing?.transport ?? "local-fake");
    if (!name || !nodeId) throw problem("Agent name and node ID are required.");
    if (name.length > 60 || nodeId.length > 60) throw problem("Agent name and node ID must be at most 60 characters.");
    if (name.includes("\n") || nodeId.includes("\n")) throw problem("Agent identity must be a single line.");
    if (!TRANSPORTS.has(transport)) throw problem("Unsupported agent transport.");
    const color = clean(input.color, existing?.color ?? "yellow");
    if (!COLORS.has(color)) throw problem("Unsupported agent color.");
    const agent = {
      id: existing?.id ?? randomUUID(),
      name,
      nodeId,
      transport,
      centralWorkspace: clean(input.centralWorkspace, existing?.centralWorkspace ?? "runtime/hub/central"),
      color,
      enabled: typeof input.enabled === "boolean" ? input.enabled : existing?.enabled ?? true,
    };
    if (transport === "remote-acp") {
      agent.config = clean(input.config, existing?.config);
      if (!agent.config) throw problem("Remote ACP agents require a connector config path.");
    } else if (transport === "local-opencode") {
      agent.command = clean(input.command, existing?.command);
      if (!agent.command || !agent.centralWorkspace) throw problem("OpenCode agents require a CLI path and workspace.");
    } else {
      agent.workspace = clean(input.workspace, existing?.workspace);
      agent.state = clean(input.state, existing?.state);
      if (!agent.workspace || !agent.state) throw problem("Local fake agents require workspace and state paths.");
    }
    return agent;
  }

  assertUniqueAgentName(agent) {
    if (this.state.agentDefinitions.some((candidate) => candidate.id !== agent.id && candidate.name.toLowerCase() === agent.name.toLowerCase())) {
      throw problem("An agent with that name already exists.", 409);
    }
  }

  async createAgent(input) {
    const agent = this.normalizeAgent(input);
    this.assertUniqueAgentName(agent);
    this.state.agentDefinitions.push(agent);
    this.state.agents.push({
      id: agent.id,
      sessionId: null,
      health: { status: agent.enabled ? "unknown" : "disabled", checkedAt: null, error: null },
    });
    await this.save();
    this.emit("change");
    return agent;
  }

  async updateAgent(agentId, input) {
    const index = this.state.agentDefinitions.findIndex((agent) => agent.id === agentId);
    if (index < 0) throw problem("Agent not found.", 404);
    const previous = this.state.agentDefinitions[index];
    const agent = this.normalizeAgent(input, previous);
    this.assertUniqueAgentName(agent);
    const resetSession = EXECUTION_FIELDS.some((field) => agent[field] !== previous[field]);
    const restart = resetSession || agent.name !== previous.name || agent.enabled === false;
    if (restart) await this.runtime.stopAgent(agentId);
    this.state.agentDefinitions[index] = agent;
    const session = this.state.agents.find((candidate) => candidate.id === agentId);
    if (session) {
      if (resetSession) session.sessionId = null;
      if (!agent.enabled) session.health = { status: "disabled", checkedAt: new Date().toISOString(), error: null };
      else if (!previous.enabled || resetSession) session.health = { status: "unknown", checkedAt: null, error: null };
    }
    await this.save();
    this.emit("change");
    return agent;
  }

  async removeAgent(agentId) {
    const index = this.state.agentDefinitions.findIndex((agent) => agent.id === agentId);
    if (index < 0) throw problem("Agent not found.", 404);
    await this.runtime.stopAgent(agentId);
    this.state.agentDefinitions.splice(index, 1);
    this.state.agents = this.state.agents.filter((agent) => agent.id !== agentId);
    for (const room of this.state.rooms) room.agentIds = room.agentIds.filter((id) => id !== agentId);
    await this.save();
    this.emit("change");
    return { removed: agentId };
  }

  async testAgent(agentId) {
    const agent = this.definitionPublic(agentId);
    const session = this.state.agents.find((candidate) => candidate.id === agentId);
    if (!agent.enabled) return { agentId, ...session.health };
    session.health = { status: "checking", checkedAt: null, error: null };
    this.emit("change");
    try {
      await this.runtime.test(agentId);
      session.health = { status: "available", checkedAt: new Date().toISOString(), error: null };
    } catch (error) {
      const status = /config|credential|token|required|ENOENT/i.test(error.message) ? "misconfigured" : "unavailable";
      session.health = { status, checkedAt: new Date().toISOString(), error: error.message };
    }
    await this.save();
    this.emit("change");
    return { agentId, ...session.health };
  }

  async post({ text, clientMessageId, roomId = "army" }) {
    const messageText = clean(text);
    if (!messageText) throw problem("Message text is required.");
    if (messageText.length > 16_000) throw problem("Message is too long.", 413);
    const room = this.room(roomId);
    const receipt = clean(clientMessageId).slice(0, 128) || randomUUID();
    const existingId = this.state.receipts[receipt];
    if (existingId) {
      return { message: this.state.messages.find((message) => message.id === existingId), recipients: [], executions: [], duplicate: true };
    }
    const recipients = this.recipients(messageText, room);
    if (recipients.length > MAX_TURNS_PER_REQUEST) {
      throw problem(`A request can start at most ${MAX_TURNS_PER_REQUEST} agent turns.`, 409);
    }
    const message = {
      id: randomUUID(),
      roomId: room.id,
      authorId: "mo",
      authorType: "user",
      authorName: "Mo",
      text: messageText,
      createdAt: new Date().toISOString(),
      recipients,
    };
    const executions = recipients.map((agentId) => {
      const at = new Date().toISOString();
      return {
        id: randomUUID(),
        roomId: room.id,
        originId: message.id,
        agentId,
        status: "queued",
        createdAt: at,
        updatedAt: at,
        startedAt: null,
        endedAt: null,
        attempt: 1,
        retryOf: null,
        retrySafe: false,
        error: null,
        resultMessageId: null,
        history: [{ from: null, to: "queued", at }],
      };
    });
    this.state.messages.push(message);
    this.state.executions.push(...executions);
    this.state.receipts[receipt] = message.id;
    await this.save();
    this.emit("change");
    for (const execution of executions) void this.execute(execution.id);
    return { message, recipients, executions, duplicate: false };
  }

  transitionExecution(execution, status, { error = undefined, resultMessageId = undefined } = {}) {
    const allowed = {
      queued: ["running", "waiting", "failed", "interrupted", "unknown"],
      running: ["waiting", "completed", "failed", "interrupted", "unknown"],
      waiting: ["queued", "running", "interrupted", "unknown"],
      completed: [],
      failed: [],
      interrupted: [],
      unknown: [],
    };
    if (!allowed[execution.status]?.includes(status)) throw problem(`Cannot change execution from ${execution.status} to ${status}.`, 409);
    const at = new Date().toISOString();
    const previous = execution.status;
    execution.status = status;
    execution.updatedAt = at;
    if (status === "running" && !execution.startedAt) execution.startedAt = at;
    if (["completed", "failed", "interrupted", "unknown"].includes(status)) execution.endedAt = at;
    if (error !== undefined) execution.error = error;
    if (resultMessageId !== undefined) execution.resultMessageId = resultMessageId;
    execution.history.push({ from: previous, to: status, at, ...(error ? { error } : {}) });
  }

  async execute(executionId) {
    const execution = this.state.executions.find((candidate) => candidate.id === executionId);
    if (!execution) throw problem("Execution not found.", 404);
    if (execution.status !== "queued") return execution;
    const origin = this.state.messages.find((message) => message.id === execution.originId);
    const agent = this.state.agentDefinitions.find((candidate) => candidate.id === execution.agentId);
    try {
      if (!origin || !agent) throw problem("Execution origin or agent is missing.", 404);
      const sessionId = this.state.agents.find((candidate) => candidate.id === execution.agentId)?.sessionId;
      const result = await this.runtime.run(execution.agentId, sessionId, origin.text, {
        executionId,
        onStart: async () => {
          if (execution.status !== "queued") return;
          this.transitionExecution(execution, "running");
          await this.save();
          this.emit("change");
        },
      });
      if (result.cancelled || execution.status !== "running") return execution;
      const reply = {
        id: randomUUID(),
        roomId: origin.roomId,
        authorId: execution.agentId,
        authorType: "agent",
        authorName: agent.name,
        nodeId: agent.nodeId,
        originId: origin.id,
        text: result.answer || `Agent completed with stop reason ${result.stopReason}.`,
        createdAt: new Date().toISOString(),
      };
      this.state.messages.push(reply);
      this.transitionExecution(execution, "completed", { error: null, resultMessageId: reply.id });
      await this.save();
      this.emit("change");
    } catch (error) {
      if (!["queued", "running"].includes(execution.status)) return execution;
      const reply = {
        id: randomUUID(),
        roomId: execution.roomId,
        authorId: execution.agentId,
        authorType: "error",
        authorName: agent?.name ?? execution.agentId,
        nodeId: agent?.nodeId,
        originId: execution.originId,
        text: `Execution failed: ${error.message}`,
        createdAt: new Date().toISOString(),
      };
      this.state.messages.push(reply);
      execution.retrySafe = error.retrySafe === true;
      this.transitionExecution(execution, "failed", { error: error.message, resultMessageId: reply.id });
      await this.save();
      this.emit("change");
    }
    return execution;
  }

  execution(executionId) {
    const execution = this.state.executions.find((candidate) => candidate.id === executionId);
    if (!execution) throw problem("Execution not found.", 404);
    return execution;
  }

  async stopExecution(executionId) {
    const execution = this.execution(executionId);
    if (!["queued", "running", "waiting"].includes(execution.status)) throw problem("Only active work can be stopped.", 409);
    const status = execution.status;
    this.runtime.cancel(execution.id);
    this.transitionExecution(execution, "interrupted", { error: "Stopped by Mo.", resultMessageId: null });
    execution.retrySafe = false;
    if (status === "running") await this.runtime.interrupt(execution.agentId);
    await this.save();
    this.emit("change");
    return execution;
  }

  async retryExecution(executionId) {
    const previous = this.execution(executionId);
    if (previous.status !== "failed" || !previous.retrySafe) throw problem("Only known-safe pre-execution failures can be retried.", 409);
    if (this.state.executions.some((execution) => execution.retryOf === previous.id)) throw problem("This failure has already been retried.", 409);
    const origin = this.state.messages.find((message) => message.id === previous.originId);
    const agent = this.definitionPublic(previous.agentId);
    this.room(previous.roomId);
    if (!origin) throw problem("Execution origin not found.", 404);
    if (!agent.enabled) throw problem("Enable the agent before retrying.", 409);
    const at = new Date().toISOString();
    const execution = {
      id: randomUUID(),
      roomId: previous.roomId,
      originId: previous.originId,
      agentId: previous.agentId,
      status: "queued",
      createdAt: at,
      updatedAt: at,
      startedAt: null,
      endedAt: null,
      attempt: previous.attempt + 1,
      retryOf: previous.id,
      retrySafe: false,
      error: null,
      resultMessageId: null,
      history: [{ from: null, to: "queued", at }],
    };
    this.state.executions.push(execution);
    await this.save();
    this.emit("change");
    void this.execute(execution.id);
    return execution;
  }

  definitionPublic(agentId) {
    const agent = this.state.agentDefinitions.find((candidate) => candidate.id === agentId);
    if (!agent) throw problem(`Unknown agent ${agentId}`, 404);
    return agent;
  }

  async stop() {
    await this.runtime.stop();
    await this.saveQueue;
  }
}
