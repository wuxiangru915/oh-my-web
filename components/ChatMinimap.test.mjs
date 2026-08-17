import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { extractTurns, extractMessageText } = await jiti.import("./ChatMinimap.tsx");

test("extractMessageText correctly extracts text from string and block messages", () => {
  const userMsg = { role: "user", content: "Hello world" };
  assert.equal(extractMessageText(userMsg), "Hello world");

  const userBlockMsg = {
    role: "user",
    content: [{ type: "text", text: "Line 1" }, { type: "text", text: "Line 2" }],
  };
  assert.equal(extractMessageText(userBlockMsg), "Line 1\nLine 2");

  const assistantMsg = {
    role: "assistant",
    content: [{ type: "text", text: "Response text" }],
  };
  assert.equal(extractMessageText(assistantMsg), "Response text");
});

test("extractTurns groups user questions and assistant answers into turn structures", () => {
  const messages = [
    { role: "user", content: "Question 1" },
    { role: "assistant", content: [{ type: "text", text: "Answer 1" }] },
    { role: "user", content: "Question 2" },
    { role: "assistant", content: [{ type: "text", text: "Answer 2" }] },
  ];

  const turns = extractTurns(messages);
  assert.equal(turns.length, 2);

  assert.equal(turns[0].turnIndex, 0);
  assert.equal(turns[0].userText, "Question 1");
  assert.equal(turns[0].assistantText, "Answer 1");
  assert.match(turns[0].fullMarkdown, /Turn 1/);
  assert.match(turns[0].fullMarkdown, /Question 1/);

  assert.equal(turns[1].turnIndex, 1);
  assert.equal(turns[1].userText, "Question 2");
  assert.equal(turns[1].assistantText, "Answer 2");
});

test("extractTurns handles compaction summaries as anchor turns", () => {
  const messages = [
    { role: "user", content: "First prompt" },
    { role: "custom", customType: "compaction", content: "Compacted summary of earlier context" },
    { role: "assistant", content: [{ type: "text", text: "Followup answer" }] },
  ];

  const turns = extractTurns(messages);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].userText, "First prompt");
  assert.equal(turns[1].userText, "Compacted summary of earlier context");
  assert.equal(turns[1].assistantText, "Followup answer");
});
