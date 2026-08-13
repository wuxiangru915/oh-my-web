/**
 * Mention token parsing for the chat composer highlight layer.
 *
 * The composer is a transparent <textarea> stacked on top of a highlight
 * backdrop. The backdrop renders the same text but wraps invoked skills,
 * slash commands, and @-file mentions in chips so those "calls" read as
 * distinct from the free-form prompt.
 */

export type MentionKind = "skill" | "command" | "file";

export type HighlightSegment =
  | { kind: "text"; text: string }
  | { kind: MentionKind; text: string };

// A slash command only counts as a mention when it starts a new token. The
// negative lookbehind rejects URLs and paths: "https://…/path" must not be
// chopped into /command chips (the slash after `:` or a letter is a path
// separator, not a command).
const MENTION_RE = /(?<![\w:./])(\/skill:[\w.-]+)|(?<![\w:./])(\/[a-zA-Z][\w.-]*)|(@"[^"]*")|(@[^\s@/]+)/g;

/** Split `text` into plain-text and mention segments, preserving order. */
export function parseMentions(text: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    const full = match[0];
    if (match[1] !== undefined) {
      segments.push({ kind: "skill", text: full });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "command", text: full });
    } else {
      segments.push({ kind: "file", text: full });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

/** True when the text contains at least one mention token worth highlighting. */
export function hasMention(text: string): boolean {
  MENTION_RE.lastIndex = 0;
  return MENTION_RE.test(text);
}
