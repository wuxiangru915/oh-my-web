import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseMentions, hasMention } = await jiti.import("./mention-highlight.ts");

test("parses skill, command and file mentions in order", () => {
  const segments = parseMentions("/skill:anysearch hello @file.txt /compact");
  assert.deepEqual(segments, [
    { kind: "skill", text: "/skill:anysearch" },
    { kind: "text", text: " hello " },
    { kind: "file", text: "@file.txt" },
    { kind: "text", text: " " },
    { kind: "command", text: "/compact" },
  ]);
});

test("parses a quoted file mention including the quotes", () => {
  const segments = parseMentions('see @"my file.txt" now');
  assert.deepEqual(segments, [
    { kind: "text", text: "see " },
    { kind: "file", text: '@"my file.txt"' },
    { kind: "text", text: " now" },
  ]);
});

test("treats a bare slash as plain text", () => {
  const segments = parseMentions("1 / 2");
  assert.deepEqual(segments, [{ kind: "text", text: "1 / 2" }]);
});

test("returns a single text segment when there are no mentions", () => {
  const segments = parseMentions("plain prompt");
  assert.deepEqual(segments, [{ kind: "text", text: "plain prompt" }]);
});

test("hasMention detects mentions and ignores plain text", () => {
  assert.equal(hasMention("/skill:api"), true);
  assert.equal(hasMention("use @file.txt"), true);
  assert.equal(hasMention("no mentions here"), false);
});
