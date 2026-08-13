import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MessageView, replaceUserMessageText } = await jiti.import("./MessageView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderMessage(message) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MessageView, { message }),
    ),
  );
}

const COMPLETE_SKILL_EXPANSION = `<skill name="review" location="/skills/review/SKILL.md">
References are relative to /skills/review.

Review the supplied files.
</skill>

src/main.ts`;

test("renders a provider error when the assistant message has no content", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [],
    stopReason: "error",
    errorMessage: "OpenAI API error (403): <html>request forbidden</html>",
  });

  assert.match(html, /role="alert"/);
  assert.match(html, /Error: OpenAI API error \(403\)/);
  assert.match(html, /&lt;html&gt;request forbidden&lt;\/html&gt;/);
});

test("renders partial assistant content before the provider error", () => {
  const html = renderMessage({
    role: "assistant",
    provider: "openai",
    model: "gpt-test",
    content: [{ type: "text", text: "Partial response" }],
    stopReason: "error",
    errorMessage: "Connection closed",
  });

  assert.match(html, /Partial response/);
  assert.match(html, /Error: Connection closed/);
});

test("renders a complete SDK skill expansion as a chip (no collapsible block)", () => {
  const html = renderMessage({
    role: "user",
    content: COMPLETE_SKILL_EXPANSION,
  });

  assert.match(html, /skill: review/);
  // The skill renders as a compact chip: no source path, no inline body.
  assert.doesNotMatch(html, /\/skills\/review\/SKILL\.md/);
  assert.doesNotMatch(html, /Review the supplied files/);
  assert.doesNotMatch(html, /References are relative/);
  // Text outside the <skill> block is still rendered.
  assert.match(html, /src\/main\.ts/);
});

test("does not collapse incomplete skill-looking user text", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="review" location="/skills/review/SKILL.md">\nordinary user text',
  });

  assert.match(html, /ordinary user text/);
  assert.doesNotMatch(html, /aria-expanded/);
});

test("keeps attached images when restoring a compact command for editing", () => {
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "QUJDRA==" },
  };
  const restored = replaceUserMessageText({
    role: "user",
    content: [{ type: "text", text: COMPLETE_SKILL_EXPANSION }, image],
  }, "/skill:review src/main.ts");

  assert.deepEqual(restored.content, [
    { type: "text", text: "/skill:review src/main.ts" },
    image,
  ]);
});

test("renders user-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "user",
    content: [
      { type: "text", text: "inspect this" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
    ],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders custom-message images as buttons that open a larger preview", () => {
  const html = renderMessage({
    role: "custom",
    customType: "extension",
    content: [{ type: "image", data: "YWJj", mimeType: "image/png" }],
    timestamp: Date.now(),
  });

  assert.match(html, /<button[^>]+aria-label="Preview image"[^>]*>/);
  assert.match(html, /<img[^>]+src="data:image\/png;base64,YWJj"/);
});

test("renders skill blocks as compact chips in user messages", () => {
  const html = renderMessage({
    role: "user",
    content: '<skill name="git" location="/home/me/.pi/skills/git/SKILL.md">\nRun the standard git workflow.\n</skill>',
  });

  // Chip shows the skill name only; the location is dropped and the body hidden.
  assert.match(html, /skill: git/);
  assert.doesNotMatch(html, /\/home\/me\/\.pi\/skills\/git\/SKILL\.md/);
  assert.doesNotMatch(html, /Run the standard git workflow/);
});

test("keeps user messages without skill blocks intact", () => {
  const html = renderMessage({
    role: "user",
    content: "Please run the git workflow",
  });

  assert.match(html, /Please run the git workflow/);
});

test("keeps text around collapsed skill blocks", () => {
  const html = renderMessage({
    role: "user",
    content: 'intro\n\n<skill name="git" location="/x/SKILL.md">\nSecret body text.\n</skill>\n\noutro',
  });

  assert.match(html, /intro/);
  assert.match(html, /outro/);
  assert.doesNotMatch(html, /Secret body text/);
});

test("renders attachment lines as file cards instead of raw paths", () => {
  const html = renderMessage({
    role: "user",
    content: "see the file\n\n[附件] /home/me/.local/share/pi-web/attachments/report.pdf",
  });

  assert.match(html, /report\.pdf/);
  assert.match(html, /\/api\/attachments\?path=/);
  assert.doesNotMatch(html, />[^<]*\.local\/share\/pi-web/);
});

test("keeps user messages without attachments intact", () => {
  const html = renderMessage({
    role: "user",
    content: "just text",
  });

  assert.match(html, /just text/);
});
