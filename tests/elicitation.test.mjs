import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForm, protocolValue, validateFormContent } from "../server/elicitation.mjs";

const request = (properties, required = []) => ({
  mode: "form",
  requestedSchema: { type: "object", properties, required },
});

test("ACP form normalization and answers cover all supported field types", () => {
  const form = normalizeForm(request({
    text: { type: "string", minLength: 2, maxLength: 20, pattern: "^[a-z]+$" },
    single: { type: "string", oneOf: [{ const: "a", title: "A" }, { const: "b", title: "B" }] },
    count: { type: "integer", minimum: 1, maximum: 5 },
    ratio: { type: "number", minimum: 0, maximum: 1 },
    enabled: { type: "boolean" },
    multiple: { type: "array", items: { type: "string", anyOf: [{ const: "x", title: "X" }, { const: "y", title: "Y" }] }, minItems: 1, maxItems: 2 },
    enumMultiple: { type: "array", items: { type: "string", enum: ["one", "two"] } },
  }, ["text", "single"]));
  const content = validateFormContent(form, {
    text: "valid",
    single: "b",
    count: 3,
    ratio: 0.5,
    enabled: false,
    multiple: ["x", "y"],
    enumMultiple: ["two"],
  });
  assert.deepEqual(content.multiple, ["x", "y"]);
  assert.deepEqual(content.enumMultiple, ["two"]);
  assert.throws(() => validateFormContent(form, { text: "valid", single: "invented" }), /offered choices/);
  assert.throws(() => validateFormContent(form, { text: "valid", single: "a", extra: true }), /Unknown question answer/);
  assert.throws(() => validateFormContent(form, { single: "a" }), /Missing required/);
});

test("invalid or unsupported question schemas fail instead of rendering a false form", () => {
  assert.throws(() => normalizeForm({ mode: "url", requestedSchema: {} }), /Only session-scoped form/);
  assert.throws(() => normalizeForm(request({ secret: { type: "object" } }, ["secret"])), /Unsupported question field type/);
  assert.throws(() => normalizeForm(request({ choice: { type: "string", enum: ["a"], oneOf: [{ const: "a", title: "A" }] } })), /cannot combine/);
  assert.throws(() => normalizeForm({ mode: "form", requestedSchema: { type: "object", properties: {}, required: ["missing"] } }), /missing/);
});

test("operation snapshots preserve complete nested data while redacting credentials", () => {
  const operation = protocolValue({
    rawInput: { command: ["sh", "-c", "printf 'hello\\n' > result.txt"], token: "github_pat_FAKE123456789" },
    locations: [{ path: "/work/result.txt", line: 4 }],
    content: [{ type: "diff", path: "/work/result.txt", oldText: "before\n", newText: "after\n" }],
  });
  assert.deepEqual(operation.rawInput.command, ["sh", "-c", "printf 'hello\\n' > result.txt"]);
  assert.equal(operation.rawInput.token, "[REDACTED]");
  assert.equal(operation.locations[0].path, "/work/result.txt");
  assert.equal(operation.content[0].oldText, "before\n");
  assert.equal(operation.content[0].newText, "after\n");
});
