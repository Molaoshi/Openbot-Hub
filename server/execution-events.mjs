import { protocolValue } from "./elicitation.mjs";

const MAX_STRING = 32_000;
const MAX_ITEMS = 100;
const MAX_DEPTH = 10;
const OPERATION_FIELDS = ["kind", "status", "rawInput", "rawOutput", "locations", "content"];
const text = (value, fallback = "", limit = 240) => typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : fallback;

function bounded(value, depth = 0) {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\n… [truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => bounded(item, depth + 1));
  if (value && typeof value === "object" && depth < MAX_DEPTH) {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_ITEMS).map(([key, item]) => [key.slice(0, 240), bounded(item, depth + 1)]));
  }
  if (depth >= MAX_DEPTH && value && typeof value === "object") return "[truncated]";
  return value;
}

function operation(update) {
  const sanitized = bounded(protocolValue(Object.fromEntries(OPERATION_FIELDS.filter((key) => update[key] !== undefined).map((key) => [key, update[key]]))));
  return sanitized;
}

function planStatus(entries) {
  if (entries.length && entries.every((entry) => entry.status === "completed")) return "completed";
  if (entries.some((entry) => entry.status === "in_progress")) return "in_progress";
  return "pending";
}

export function normalizeExecutionEvent(params) {
  const update = params?.update;
  if (!update || typeof update !== "object") return null;
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const toolCallId = text(update.toolCallId);
    if (!toolCallId) return null;
    return {
      type: "tool",
      toolCallId,
      title: text(protocolValue(update.title), "Tool call"),
      status: text(update.status, "pending", 60),
      operation: operation(update),
    };
  }
  if (update.sessionUpdate === "plan") {
    const entries = (Array.isArray(update.entries) ? update.entries : []).slice(0, MAX_ITEMS).filter((entry) => entry && typeof entry === "object").map((entry) => ({
      content: text(protocolValue(entry.content), "Untitled step", MAX_STRING),
      status: text(entry.status, "pending", 60),
      ...(text(entry.priority) ? { priority: text(entry.priority, "", 60) } : {}),
    }));
    return { type: "plan", title: "Plan", status: planStatus(entries), entries };
  }
  return null;
}
