import { readFileSync } from "fs";
import { stripFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Multi-skill command expansion.
 *
 * pi's AgentSession._expandSkillCommand only expands the FIRST `/skill:name`
 * token at the start of a message; any subsequent `/skill:name` tokens are
 * treated as plain arguments. When a user invokes several skills in one
 * message (e.g. `/skill:a /skill:b`), we expand every skill command ourselves
 * so each one reaches the model as a full `<skill>` block.
 */

export interface ExpandableSkill {
  name: string;
  filePath: string;
  baseDir: string;
}

const SKILL_COMMAND_RE = /\/skill:([^\s/]+)/g;

/** Build the same `<skill>` envelope pi's `_expandSkillCommand` produces. */
function buildSkillBlock(skill: ExpandableSkill, body: string): string {
  return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

/**
 * Expand every `/skill:name` command in `text` into a `<skill>` block.
 *
 * A single leading `/skill:name` is left untouched so pi expands it natively
 * (preserving its exact behaviour); any other case — multiple skill commands,
 * or a skill command that is not at the very start — is expanded here.
 */
export function expandAllSkillCommands(text: string, skills: ExpandableSkill[]): string {
  if (!text.includes("/skill:")) return text;

  const matches = Array.from(text.matchAll(SKILL_COMMAND_RE));
  if (matches.length === 0) return text;

  const singleLeading = matches.length === 1 && matches[0].index === 0;
  if (singleLeading) return text;

  // Replace from the end so earlier match indices stay valid.
  let result = text;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    const skillName = match[1];
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) continue;
    try {
      const content = readFileSync(skill.filePath, "utf8");
      const body = stripFrontmatter(content).trim();
      const block = buildSkillBlock(skill, body);
      result = result.slice(0, match.index) + block + result.slice(match.index + match[0].length);
    } catch {
      // Read failure: leave the original command untouched so pi can try.
    }
  }
  return result;
}
