import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";

export async function readConfig(path) {
  const configPath = resolve(path);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const root = resolve(dirname(configPath), "..");
  const fromRoot = (value) => (value ? resolve(root, value) : value);
  return { ...config, configPath, root, fromRoot };
}

export async function readToken(path) {
  const token = (await readFile(path, "utf8")).trim();
  if (token.length < 32) throw new Error("The connector token must contain at least 32 characters.");
  return token;
}

export function tokensEqual(left, right) {
  const a = Buffer.from(left ?? "");
  const b = Buffer.from(right ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function jsonLine(socket, value) {
  socket.write(`${JSON.stringify(value)}\n`);
}

export function textFromPrompt(prompt) {
  const blocks = Array.isArray(prompt) ? prompt : [];
  const texts = blocks.filter((block) => block?.type === "text" && typeof block.text === "string");
  return texts.at(-1)?.text ?? "";
}
