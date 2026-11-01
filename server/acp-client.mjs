import { spawn } from "node:child_process";

export class AcpClient {
  constructor({ command, args, env = {}, cwd, requestTimeoutMs = 120_000 }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.cwd = cwd;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.pending = new Map();
    this.notifications = [];
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
    this.startPromise = null;
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      this.child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-16_000);
      });
      this.child.stdout.on("data", (chunk) => this.#consume(chunk));
      this.child.once("exit", (code) => {
        for (const { reject } of this.pending.values()) {
          reject(new Error(`ACP process exited (${code}): ${this.stderr}`));
        }
        this.pending.clear();
        this.child = null;
        this.startPromise = null;
      });
      await this.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    })();
    return this.startPromise;
  }

  #consume(chunk) {
    this.buffer += chunk.toString("utf8");
    for (let index = this.buffer.indexOf("\n"); index >= 0; index = this.buffer.indexOf("\n")) {
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && message.method) {
        this.child?.stdin.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unsupported client method: ${message.method}` },
        })}\n`);
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(`${message.error.code}: ${message.error.message}`);
          error.retrySafe = message.error.code === -32010;
          pending.reject(error);
        } else pending.resolve(message.result);
      } else if (message.method === "session/update") {
        this.notifications.push(message.params);
      }
    }
  }

  request(method, params = {}) {
    if (!this.child) throw new Error("ACP client is not running.");
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out: ${this.stderr}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  async ensureSession(sessionId, cwd) {
    await this.start();
    if (sessionId) {
      try {
        await this.request("session/load", { sessionId, cwd, mcpServers: [] });
        return sessionId;
      } catch (error) {
        if (!/not found/i.test(error.message)) throw error;
      }
    }
    const created = await this.request("session/new", { cwd, mcpServers: [] });
    return created.sessionId;
  }

  async prompt(sessionId, text) {
    const baseline = this.notifications.length;
    const result = await this.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    const answer = this.notifications.slice(baseline)
      .filter((entry) => entry.sessionId === sessionId && entry.update?.sessionUpdate === "agent_message_chunk")
      .map((entry) => entry.update.content?.text ?? "")
      .join("");
    return { answer, stopReason: result.stopReason };
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
}
