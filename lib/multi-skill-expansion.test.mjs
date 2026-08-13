import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { expandAllSkillCommands } = await jiti.import("./multi-skill-expansion.ts");

const skills = [
  { name: "anysearch", filePath: "/home/wxr/.agents/skills/anysearch/SKILL.md", baseDir: "/home/wxr/.agents/skills/anysearch" },
  { name: "api", filePath: "/home/wxr/.agents/skills/api/SKILL.md", baseDir: "/home/wxr/.agents/skills/api" },
];

test("leaves a single leading skill command untouched (pi expands it natively)", () => {
  const out = expandAllSkillCommands("/skill:anysearch search the web", skills);
  assert.equal(out, "/skill:anysearch search the web");
});

test("expands every skill command when multiple are present", () => {
  const out = expandAllSkillCommands("/skill:anysearch /skill:api", skills);
  assert.match(out, /<skill name="anysearch"/);
  assert.match(out, /<skill name="api"/);
  assert.doesNotMatch(out, /\/skill:anysearch/);
  assert.doesNotMatch(out, /\/skill:api/);
});

test("expands a skill command that is not at the start", () => {
  const out = expandAllSkillCommands("please /skill:anysearch for this", skills);
  assert.match(out, /<skill name="anysearch"/);
  assert.doesNotMatch(out, /\/skill:anysearch/);
  assert.match(out, /please /);
});

test("keeps unknown skills untouched while expanding known ones", () => {
  const out = expandAllSkillCommands("/skill:unknown /skill:anysearch", skills);
  assert.match(out, /\/skill:unknown/);
  assert.match(out, /<skill name="anysearch"/);
});

test("returns text unchanged when no skill command is present", () => {
  const out = expandAllSkillCommands("hello world", skills);
  assert.equal(out, "hello world");
});
