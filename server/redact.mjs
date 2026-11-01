const REDACTIONS = [
  [/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]+\b/g, "[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
  [/\b(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]"],
  [/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|authorization|token|secret|password|credential)["']?\s*[:=]\s*["']?)[^"',\s;}]+/gi, "$1[REDACTED]"],
];

export function redactError(value) {
  let text = typeof value === "string" ? value : String(value ?? "Unknown error");
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text.slice(0, 16_000);
}
