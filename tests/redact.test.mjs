import test from "node:test";
import assert from "node:assert/strict";
import { redactError } from "../server/redact.mjs";

test("provider and connector credential shapes are redacted from errors", () => {
  const secrets = ["github_pat_FAKE123456789", "ghp_FAKE123456789", "sk-FAKE123456789", "fake-bearer-value", "fake-api-key", "fake-password"];
  const redacted = redactError(`github_pat_FAKE123456789 ghp_FAKE123456789 sk-FAKE123456789 Authorization: Bearer fake-bearer-value apiKey=fake-api-key password: fake-password`);
  for (const secret of secrets) assert.equal(redacted.includes(secret), false);
  assert.match(redacted, /\[REDACTED\]/);
});
