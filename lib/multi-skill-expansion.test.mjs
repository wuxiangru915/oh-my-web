import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { expandAllSkillCommands } = await jiti.import("./multi-skill-expansion.ts");

function createFixtureSkills(t) {
  const root = mkdtempSync(join(tmpdir(), "omw-skill-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pairs = [
    ["anysearch", "anysearch skill content"],
    ["api", "api skill content"],
  ];
  return pairs.map(([name, content]) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "SKILL.md");
    writeFileSync(filePath, `---\nname: ${name}\n---\n${content}`);
    return { name, filePath, baseDir: dir };
  });
}

test("leaves a single leading skill command untouched (pi expands it natively)", (t) => {
  const skills = createFixtureSkills(t);
  const out = expandAllSkillCommands("/skill:anysearch search the web", skills);
  assert.equal(out, "/skill:anysearch search the web");
});

test("expands every skill command when multiple are present", (t) => {
  const skills = createFixtureSkills(t);
  const out = expandAllSkillCommands("/skill:anysearch /skill:api", skills);
  assert.match(out, /<skill name="anysearch"/);
  assert.match(out, /<skill name="api"/);
  assert.doesNotMatch(out, /\/skill:anysearch/);
  assert.doesNotMatch(out, /\/skill:api/);
});

test("expands a skill command that is not at the start", (t) => {
  const skills = createFixtureSkills(t);
  const out = expandAllSkillCommands("please /skill:anysearch for this", skills);
  assert.match(out, /<skill name="anysearch"/);
  assert.doesNotMatch(out, /\/skill:anysearch/);
  assert.match(out, /please /);
});

test("keeps unknown skills untouched while expanding known ones", (t) => {
  const skills = createFixtureSkills(t);
  const out = expandAllSkillCommands("/skill:unknown /skill:anysearch", skills);
  assert.match(out, /\/skill:unknown/);
  assert.match(out, /<skill name="anysearch"/);
});

test("returns text unchanged when no skill command is present", (t) => {
  const skills = createFixtureSkills(t);
  const out = expandAllSkillCommands("hello world", skills);
  assert.equal(out, "hello world");
});
