import { resolve } from "node:path";
import { AcpClient } from "./acp-client.mjs";

export class AgentRuntime {
  constructor({ root, agents, onSession }) {
    this.root = root;
    this.agents = agents;
    this.onSession = onSession;
    this.clients = new Map();
    this.queues = new Map();
    this.cancellations = new Set();
  }

  definition(agentId) {
    const agent = this.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }

  client(agent) {
    if (this.clients.has(agent.id)) return this.clients.get(agent.id);
    const common = { cwd: this.root };
    const client = agent.transport === "remote-acp"
      ? new AcpClient({
          ...common,
          command: process.execPath,
          args: [resolve(this.root, "connectors/remote-acp/proxy.mjs"), "--config", resolve(this.root, agent.config)],
        })
      : new AcpClient({
          ...common,
          command: process.execPath,
          args: [resolve(this.root, "connectors/remote-acp/fake-harness.mjs")],
          env: {
            OPENBOT_HUB_NODE_ID: agent.nodeId,
            OPENBOT_HUB_AGENT_TITLE: agent.name,
            OPENBOT_HUB_WORKSPACE: resolve(this.root, agent.workspace),
            OPENBOT_HUB_STATE_ROOT: resolve(this.root, agent.state),
          },
        });
    this.clients.set(agent.id, client);
    return client;
  }

  run(agentId, sessionId, text, { executionId, onStart = async () => {} } = {}) {
    const previous = this.queues.get(agentId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (this.cancellations.has(executionId)) return { cancelled: true };
      await onStart();
      if (this.cancellations.has(executionId)) return { cancelled: true };
      const agent = this.definition(agentId);
      const client = this.client(agent);
      const centralWorkspace = resolve(this.root, agent.centralWorkspace ?? agent.workspace ?? "runtime/hub/central");
      const actualSession = await client.ensureSession(sessionId, centralWorkspace);
      if (actualSession !== sessionId) await this.onSession(agentId, actualSession);
      return client.prompt(actualSession, text);
    });
    this.queues.set(agentId, next.catch(() => {}));
    return next.finally(() => this.cancellations.delete(executionId));
  }

  cancel(executionId) {
    this.cancellations.add(executionId);
  }

  async test(agentId) {
    const client = this.client(this.definition(agentId));
    await client.start();
  }

  async interrupt(agentId) {
    const client = this.clients.get(agentId);
    if (!client) return;
    this.clients.delete(agentId);
    await client.stop();
  }

  async stopAgent(agentId) {
    const queued = this.queues.get(agentId);
    if (queued) await queued;
    this.queues.delete(agentId);
    const client = this.clients.get(agentId);
    if (client) await client.stop();
    this.clients.delete(agentId);
  }

  async stop() {
    await Promise.all([...this.clients.keys()].map((agentId) => this.stopAgent(agentId)));
  }
}
