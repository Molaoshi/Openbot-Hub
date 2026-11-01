const messagesElement = document.querySelector("#messages");
const input = document.querySelector("#message-input");
const composer = document.querySelector("#composer");
const sendButton = document.querySelector("#send-button");
const agentList = document.querySelector("#agent-list");
const roomList = document.querySelector("#room-list");
const mentionRow = document.querySelector("#mention-row");
const connectionState = document.querySelector("#connection-state");
const toast = document.querySelector("#toast");
let state = { rooms: [], agents: [], messages: [], executions: [] };
let currentRoomId = "army";
try { currentRoomId = localStorage.getItem("openbot-hub.room") || "army"; } catch {}
let toastTimer;
let firstRender = true;

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
  return result;
}

function currentRoom() {
  return state.rooms.find((room) => room.id === currentRoomId) ?? state.rooms[0];
}

function members(room = currentRoom()) {
  if (!room) return [];
  return state.agents.filter((agent) => agent.enabled && (room.global || room.agentIds.includes(agent.id)));
}

function time(value) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function renderRooms() {
  document.querySelector("#room-count").textContent = String(state.rooms.length).padStart(2, "0");
  roomList.replaceChildren();
  for (const room of state.rooms) {
    const row = element("button", `room-row${room.id === currentRoomId ? " active" : ""}`);
    row.type = "button";
    row.setAttribute("aria-label", `Open ${room.name} room`);
    if (room.id === currentRoomId) row.setAttribute("aria-current", "page");
    row.append(element("span", "room-mark", room.name.slice(0, 1).toUpperCase()));
    const identity = element("span");
    identity.append(element("strong", "", room.name), element("small", "", room.global ? "All machines. One thread." : `${room.agentIds.length} selected members`));
    row.append(identity);
    row.addEventListener("click", () => {
      currentRoomId = room.id;
      try { localStorage.setItem("openbot-hub.room", room.id); } catch {}
      firstRender = true;
      renderAll();
      closeDrawers();
    });
    roomList.append(row);
  }
}

function renderHeader() {
  const room = currentRoom();
  if (!room) return;
  document.querySelector("#room-name").textContent = room.name;
  document.querySelector("#room-eyebrow").textContent = room.global ? "GLOBAL ARMY ROOM" : "PROJECT ROOM";
  document.querySelector("#room-membership").textContent = room.global ? "/ all agents" : `/ ${members(room).length} active members`;
  document.title = `OpenBot Hub — ${room.name}`;
}

function executionCard(execution) {
  const agent = state.agents.find((candidate) => candidate.id === execution.agentId);
  const card = element("article", "execution-card");
  card.dataset.executionId = execution.id;
  card.dataset.status = execution.status;
  card.title = (execution.history ?? []).map((entry) => `${entry.to} · ${entry.at}`).join("\n");
  const identity = element("div", "execution-identity");
  identity.append(
    element("strong", "", agent?.name ?? execution.agentId),
    element("span", "execution-meta", `${agent?.nodeId ?? "unknown node"} · attempt ${execution.attempt} · ${time(execution.updatedAt)}`),
  );
  const status = element("span", `execution-status status-${execution.status}`, execution.status.toUpperCase());
  const controls = element("div", "execution-controls");
  if (["queued", "running", "waiting"].includes(execution.status)) {
    const stop = element("button", "execution-action stop-execution", "Stop");
    stop.type = "button";
    stop.addEventListener("click", async () => {
      stop.disabled = true;
      try {
        await api(`/api/executions/${encodeURIComponent(execution.id)}/stop`, { method: "POST" });
        await refresh();
        showToast("Execution stopped without retrying it.");
      } catch (error) { showToast(error.message); stop.disabled = false; }
    });
    controls.append(stop);
  }
  const alreadyRetried = state.executions.some((candidate) => candidate.retryOf === execution.id);
  if (execution.status === "failed" && execution.retrySafe && !alreadyRetried) {
    const retry = element("button", "execution-action retry-execution", "Safe retry");
    retry.type = "button";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      try {
        await api(`/api/executions/${encodeURIComponent(execution.id)}/retry`, { method: "POST" });
        await refresh();
        showToast("Safe retry started as a new execution attempt.");
      } catch (error) { showToast(error.message); retry.disabled = false; }
    });
    controls.append(retry);
  }
  card.append(identity, status, controls);
  if (execution.error) card.append(element("div", "execution-error", execution.error));
  return card;
}

function renderMessages() {
  const nearBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 160;
  messagesElement.replaceChildren();
  const visible = state.messages.filter((message) => message.roomId === currentRoomId);
  for (const message of visible) {
    if (message.authorType === "system") {
      messagesElement.append(element("div", "message message-system", message.text));
      continue;
    }
    if (message.authorType === "user") {
      const row = element("article", "message message-user");
      const bubble = element("div", "message-bubble");
      bubble.append(element("div", "message-text", message.text));
      bubble.append(element("div", "message-meta", `MO · ${time(message.createdAt)}`));
      row.append(bubble);
      messagesElement.append(row);
      const related = state.executions.filter((execution) => execution.originId === message.id);
      if (related.length) {
        const list = element("div", "message execution-list");
        for (const execution of related) list.append(executionCard(execution));
        messagesElement.append(list);
      }
      continue;
    }
    const agent = state.agents.find((candidate) => candidate.id === message.authorId);
    const row = element("article", `message message-agent${message.authorType === "error" ? " message-error" : ""}`);
    row.append(element("div", `agent-avatar ${agent?.color ?? ""}`, initials(message.authorName ?? "Agent")));
    const content = element("div");
    const heading = element("div", "message-heading");
    heading.append(element("span", "message-author", message.authorName ?? message.authorId));
    if (message.nodeId) heading.append(element("span", "node-tag", message.nodeId.toUpperCase()));
    heading.append(element("span", "message-meta", time(message.createdAt)));
    content.append(heading, element("div", "message-text", message.text));
    row.append(content);
    messagesElement.append(row);
  }
  if (firstRender || nearBottom) messagesElement.scrollTop = messagesElement.scrollHeight;
  firstRender = false;
}

function address(agentName) {
  const mention = `@${agentName}`;
  const existing = input.value.trimStart();
  input.value = existing.toLowerCase().startsWith(mention.toLowerCase()) ? input.value : `${mention} ${existing}`;
  input.focus();
  closeDrawers();
}

function openAgentDialog(agent = null) {
  const dialog = document.querySelector("#agent-dialog");
  const form = document.querySelector("#agent-form");
  form.reset();
  document.querySelector("#agent-dialog-title").textContent = agent ? `Edit ${agent.name}` : "Add an agent";
  document.querySelector("#agent-id").value = agent?.id ?? "";
  document.querySelector("#agent-name-input").value = agent?.name ?? "";
  document.querySelector("#agent-node-input").value = agent?.nodeId ?? "mac-mini";
  document.querySelector("#agent-transport").value = agent?.transport ?? "local-fake";
  document.querySelector("#agent-workspace").value = agent?.workspace ?? "";
  document.querySelector("#agent-state").value = agent?.state ?? "";
  document.querySelector("#agent-config").value = agent?.config ?? "";
  document.querySelector("#agent-command").value = agent?.command ?? "";
  document.querySelector("#agent-central-workspace").value = agent?.centralWorkspace ?? "runtime/hub/central";
  document.querySelector("#agent-color").value = agent?.color ?? "yellow";
  document.querySelector("#agent-enabled").checked = agent?.enabled ?? true;
  document.querySelector("#remove-agent-button").hidden = !agent;
  updateTransportFields();
  dialog.showModal();
}

function renderAgents() {
  document.querySelector("#army-count").textContent = String(state.agents.length).padStart(2, "0");
  agentList.replaceChildren();
  for (const agent of state.agents) {
    const row = element("div", "agent-row");
    const addressButton = element("button", "agent-address");
    addressButton.type = "button";
    addressButton.disabled = !agent.enabled;
    addressButton.setAttribute("aria-label", agent.enabled ? `Mention ${agent.name} on ${agent.nodeId}` : `${agent.name} is disabled`);
    addressButton.append(element("span", `agent-presence ${agent.color}`));
    const identity = element("span");
    const name = element("span", "agent-name", agent.name);
    const health = agent.enabled ? agent.health?.status ?? "unknown" : "disabled";
    const labels = { unknown: "UNTESTED", checking: "CHECKING", available: "AVAILABLE", unavailable: "OFFLINE", misconfigured: "CONFIG", disabled: "DISABLED" };
    const badge = element("span", `agent-status health-${health}`, labels[health] ?? health.toUpperCase());
    if (agent.health?.error) badge.title = agent.health.error;
    name.append(badge);
    identity.append(name, element("span", "agent-node", `${agent.nodeId}${agent.sessionReady ? " · session saved" : ""}`));
    addressButton.append(identity, element("span", "agent-transport", agent.transport));
    addressButton.addEventListener("click", () => address(agent.name));
    const actions = element("div", "agent-actions");
    const test = element("button", "agent-test", health === "checking" ? "…" : "TEST");
    test.type = "button";
    test.disabled = !agent.enabled || health === "checking";
    test.setAttribute("aria-label", `Test ${agent.name} connectivity`);
    test.addEventListener("click", async () => {
      test.disabled = true;
      try {
        const result = await api(`/api/agents/${encodeURIComponent(agent.id)}/test`, { method: "POST" });
        await refresh();
        showToast(result.status === "available" ? `${agent.name} is available.` : `${agent.name}: ${result.error ?? result.status}`);
      } catch (error) { showToast(error.message); test.disabled = false; }
    });
    const edit = element("button", "agent-edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${agent.name}`);
    edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-1 5 5-1L19 9l-4-4L4 16ZM13.5 6.5l4 4"/></svg>';
    edit.addEventListener("click", () => openAgentDialog(agent));
    actions.append(test, edit);
    row.append(addressButton, actions);
    agentList.append(row);
  }
}

function renderMentions() {
  mentionRow.replaceChildren();
  for (const agent of members()) {
    const chip = element("button", "mention-chip", `@${agent.name}`);
    chip.type = "button";
    chip.addEventListener("click", () => address(agent.name));
    mentionRow.append(chip);
  }
  if (members().length) {
    const everyone = element("button", "mention-chip", "@everyone");
    everyone.type = "button";
    everyone.addEventListener("click", () => address("everyone"));
    mentionRow.append(everyone);
  }
}

function renderAll() {
  renderRooms();
  renderHeader();
  renderAgents();
  renderMentions();
  renderMessages();
}

async function refresh() {
  try {
    state = await api("/api/state");
    if (!state.rooms.some((room) => room.id === currentRoomId)) currentRoomId = state.rooms[0]?.id ?? "army";
    renderAll();
  } catch (error) {
    showToast(error.message);
  }
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  sendButton.disabled = true;
  try {
    const result = await api("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, roomId: currentRoomId, clientMessageId: crypto.randomUUID() }),
    });
    input.value = "";
    input.style.height = "auto";
    await refresh();
    if (result.recipients.length === 0) showToast("Message posted. Mention an enabled room member or @everyone to start execution.");
  } catch (error) {
    showToast(error.message);
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

const backdrop = document.querySelector("#backdrop");
function closeDrawers() {
  document.querySelector("#rail").classList.remove("open");
  document.querySelector("#inspector").classList.remove("open");
  backdrop.hidden = true;
}
function openDrawer(id) {
  closeDrawers();
  document.querySelector(`#${id}`).classList.add("open");
  backdrop.hidden = false;
}
document.querySelector("#rooms-button").addEventListener("click", () => openDrawer("rail"));
document.querySelector("#agents-button").addEventListener("click", () => openDrawer("inspector"));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeDrawers));
backdrop.addEventListener("click", closeDrawers);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawers(); });

function openRoomDialog(room = null) {
  closeDrawers();
  const form = document.querySelector("#room-form");
  form.reset();
  document.querySelector("#room-id").value = room?.id ?? "";
  document.querySelector("#room-dialog-title").textContent = room ? `Edit ${room.name}` : "Create a room";
  document.querySelector("#save-room-button").textContent = room ? "Save room" : "Create room";
  document.querySelector("#room-name-input").value = room?.name ?? "";
  document.querySelector("#room-name-input").disabled = Boolean(room?.global);
  document.querySelector("#room-purpose-input").value = room?.purpose ?? "";
  document.querySelector("#delete-room-button").hidden = !room || room.global;
  const options = document.querySelector("#room-member-options");
  options.replaceChildren();
  for (const agent of state.agents) {
    const label = element("label", "member-option");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = agent.id;
    checkbox.checked = room ? room.global || room.agentIds.includes(agent.id) : agent.enabled;
    checkbox.disabled = Boolean(room?.global);
    const identity = element("span");
    identity.append(element("strong", "", agent.name), element("small", "", `${agent.nodeId} · ${agent.enabled ? "enabled" : "disabled"}`));
    label.append(checkbox, identity);
    options.append(label);
  }
  document.querySelector("#room-dialog").showModal();
}

document.querySelector("#add-room-button").addEventListener("click", () => openRoomDialog());
document.querySelector("#edit-room-button").addEventListener("click", () => openRoomDialog(currentRoom()));

document.querySelector("#room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#room-id").value;
  const room = state.rooms.find((candidate) => candidate.id === id);
  const save = document.querySelector("#save-room-button");
  save.disabled = true;
  try {
    const payload = room?.global ? {
      purpose: document.querySelector("#room-purpose-input").value,
    } : {
      name: document.querySelector("#room-name-input").value,
      purpose: document.querySelector("#room-purpose-input").value,
      agentIds: [...document.querySelectorAll("#room-member-options input:checked")].map((checkbox) => checkbox.value),
    };
    const updated = await api(id ? `/api/rooms/${encodeURIComponent(id)}` : "/api/rooms", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    document.querySelector("#room-dialog").close();
    currentRoomId = updated.id;
    try { localStorage.setItem("openbot-hub.room", updated.id); } catch {}
    firstRender = true;
    await refresh();
    showToast(id ? "Room updated." : "Room created.");
  } catch (error) { showToast(error.message); }
  finally { save.disabled = false; }
});

document.querySelector("#delete-room-button").addEventListener("click", async () => {
  const id = document.querySelector("#room-id").value;
  const room = state.rooms.find((candidate) => candidate.id === id);
  if (!room || room.global || !confirm(`Delete ${room.name} and its entire message and execution history? This cannot be undone.`)) return;
  try {
    await api(`/api/rooms/${encodeURIComponent(id)}?confirm=delete-history`, { method: "DELETE" });
    document.querySelector("#room-dialog").close();
    currentRoomId = "army";
    try { localStorage.setItem("openbot-hub.room", "army"); } catch {}
    firstRender = true;
    await refresh();
    showToast("Room and its history deleted.");
  } catch (error) { showToast(error.message); }
});

function updateTransportFields() {
  const transport = document.querySelector("#agent-transport").value;
  const local = transport === "local-fake";
  const opencode = transport === "local-opencode";
  const remote = transport === "remote-acp";
  document.querySelector("#local-agent-fields").hidden = !local;
  document.querySelector("#opencode-agent-fields").hidden = !opencode;
  document.querySelector("#remote-agent-fields").hidden = !remote;
  document.querySelector("#agent-workspace").required = local;
  document.querySelector("#agent-state").required = local;
  document.querySelector("#agent-command").required = opencode;
  document.querySelector("#agent-central-workspace").required = opencode;
  document.querySelector("#agent-config").required = remote;
  document.querySelector("#central-workspace-label").textContent = opencode ? "OpenCode workspace" : "Central workspace";
  if (!document.querySelector("#agent-id").value && local && !document.querySelector("#agent-workspace").value) {
    const suffix = crypto.randomUUID().slice(0, 8);
    document.querySelector("#agent-workspace").value = `runtime/hub/agents/${suffix}-workspace`;
    document.querySelector("#agent-state").value = `runtime/hub/agents/${suffix}-state`;
    document.querySelector("#agent-central-workspace").value = `runtime/hub/agents/${suffix}-central`;
  }
}
document.querySelector("#agent-transport").addEventListener("change", () => {
  if (!document.querySelector("#agent-id").value && document.querySelector("#agent-transport").value === "local-opencode") {
    document.querySelector("#agent-central-workspace").value = "";
  }
  updateTransportFields();
});
document.querySelector("#add-agent-button").addEventListener("click", () => openAgentDialog());

document.querySelector("#agent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#agent-id").value;
  const save = document.querySelector("#save-agent-button");
  save.disabled = true;
  try {
    await api(id ? `/api/agents/${encodeURIComponent(id)}` : "/api/agents", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.querySelector("#agent-name-input").value,
        nodeId: document.querySelector("#agent-node-input").value,
        transport: document.querySelector("#agent-transport").value,
        workspace: document.querySelector("#agent-workspace").value,
        state: document.querySelector("#agent-state").value,
        config: document.querySelector("#agent-config").value,
        command: document.querySelector("#agent-command").value,
        centralWorkspace: document.querySelector("#agent-central-workspace").value,
        color: document.querySelector("#agent-color").value,
        enabled: document.querySelector("#agent-enabled").checked,
      }),
    });
    document.querySelector("#agent-dialog").close();
    await refresh();
    showToast(id ? "Agent updated." : "Agent registered.");
  } catch (error) { showToast(error.message); }
  finally { save.disabled = false; }
});

document.querySelector("#remove-agent-button").addEventListener("click", async () => {
  const id = document.querySelector("#agent-id").value;
  const agent = state.agents.find((candidate) => candidate.id === id);
  if (!agent || !confirm(`Remove ${agent.name} from the registry? Its message history will remain.`)) return;
  try {
    await api(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    document.querySelector("#agent-dialog").close();
    await refresh();
    showToast("Agent removed. Message history preserved.");
  } catch (error) { showToast(error.message); }
});

document.querySelectorAll("[data-dialog-close]").forEach((button) => {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.dialogClose}`).close());
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
}

let refreshTimer;
const events = new EventSource("/api/events");
events.addEventListener("change", () => {
  connectionState.classList.remove("offline");
  connectionState.lastElementChild.textContent = "LIVE";
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 60);
});
events.onerror = () => {
  connectionState.classList.add("offline");
  connectionState.lastElementChild.textContent = "RECONNECTING";
};
refresh();
