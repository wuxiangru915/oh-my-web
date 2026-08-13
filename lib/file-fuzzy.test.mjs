import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-fuzzy.ts");
}

test("builds closed file mentions and quotes paths containing spaces", async () => {
  const { buildAtMentionText, buildFileAtMentionsText } = await loadSubject();

  assert.equal(buildAtMentionText("notes/todo.md", false), "@notes/todo.md ");
  assert.equal(buildAtMentionText("project files/design brief.md", false), "@\"project files/design brief.md\" ");
  assert.equal(
    buildFileAtMentionsText(["notes/todo.md", "project files/design brief.md"]),
    "@notes/todo.md @\"project files/design brief.md\" ",
  );
});

test("builds line-scoped file mentions", async () => {
  const { buildFileLineMentionText } = await loadSubject();

  assert.equal(buildFileLineMentionText("src/app.ts", 12, 12), "@src/app.ts:12 ");
  assert.equal(buildFileLineMentionText("src/app.ts", 18, 12), "@src/app.ts:12-18 ");
  assert.equal(
    buildFileLineMentionText("project files/app.ts", 3, 9),
    "@\"project files/app.ts\":3-9 ",
  );
  assert.equal(buildFileLineMentionText("src/app.ts", 0, 0), "@src/app.ts:1 ");
});

test("extracts a slash token immediately before the cursor", async () => {
  const { extractSlashQuery } = await loadSubject();

  assert.deepEqual(extractSlashQuery("/"), { start: 0, query: "" });
  assert.deepEqual(extractSlashQuery("/skill"), { start: 0, query: "skill" });
  assert.deepEqual(extractSlashQuery("/skill:git"), { start: 0, query: "skill:git" });
  assert.deepEqual(extractSlashQuery("hello /skill"), { start: 6, query: "skill" });
  assert.deepEqual(extractSlashQuery("/skill:a arg /skill:b"), { start: 13, query: "skill:b" });
  assert.equal(extractSlashQuery("a/b"), null);
  assert.equal(extractSlashQuery("hello world"), null);
  assert.equal(extractSlashQuery("/skill:a arg"), null);
});
