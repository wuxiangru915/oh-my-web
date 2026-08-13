"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, TextContent, ToolCallContent, UserMessage } from "@/lib/types";

interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
}

const PANEL_WIDTH = 240;
const COLLAPSED_WIDTH = 28;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

interface EntryInfo {
  role: "user" | "assistant";
  text: string;
  scrollTop: number | null;
}

function getUserPreview(message: UserMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function getAssistantPreview(message: AssistantMessage | Partial<AgentMessage>): string {
  const content = (message as AssistantMessage).content;
  if (!Array.isArray(content)) return "";
  const text = content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (text) return text;
  const tool = content.find((block): block is ToolCallContent => block.type === "toolCall");
  return tool ? `⚙ ${tool.toolName}` : "";
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  );
}

export function ChatMinimap({
  messages,
  streamingMessage,
  scrollContainer,
  messageRefs,
  onRevealHistory,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<EntryInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const entriesRef = useRef<EntryInfo[]>([]);
  const activeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavRef = useRef<{ index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage],
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  const measure = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;

    const refs = messageRefs.current;
    const containerRect = scrollEl.getBoundingClientRect();
    const next: EntryInfo[] = [];
    let refIndex = 0;

    for (const message of allMessagesRef.current) {
      if (message.role !== "user" && message.role !== "assistant") continue;
      const element = refs?.[refIndex];
      refIndex += 1;
      const rect = element?.getBoundingClientRect();
      const scrollTop = rect ? rect.top - containerRect.top + scrollEl.scrollTop : null;
      if (message.role === "user") {
        next.push({ role: "user", text: getUserPreview(message as UserMessage), scrollTop });
      } else {
        next.push({ role: "assistant", text: getAssistantPreview(message), scrollTop });
      }
    }

    entriesRef.current = next;
    setEntries(next);
  }, [messageRefs, scrollContainer]);

  const syncActive = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const lock = activeLockRef.current;
    if (lock && Date.now() < lock.until) {
      setActiveIndex(lock.index);
      return;
    }
    activeLockRef.current = null;

    const measured = entriesRef.current.filter((entry) => entry.scrollTop !== null);
    if (measured.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nearest = measured.reduce((best, entry) => (
      Math.abs((entry.scrollTop ?? 0) - focusTop)
        < Math.abs((best.scrollTop ?? 0) - focusTop)
        ? entry
        : best
    ), measured[0]);
    setActiveIndex(entriesRef.current.indexOf(nearest));
  }, [scrollContainer]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const onScroll = () => syncActive();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      measure();
      syncActive();
    });
    ro.observe(el);
    measure();
    syncActive();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [measure, scrollContainer, syncActive]);

  useEffect(() => {
    const timer = setTimeout(() => {
      measure();
      syncActive();
    }, 50);
    return () => clearTimeout(timer);
  }, [messages.length, measure, syncActive]);

  const scrollToEntry = useCallback((index: number) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const entry = entriesRef.current[index];
    if (!entry) return;
    activeLockRef.current = { index, until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS };
    setActiveIndex(index);
    if (entry.scrollTop === null) {
      pendingNavRef.current = { index };
      onRevealHistory();
      return;
    }
    scrollEl.scrollTo({
      top: Math.max(0, entry.scrollTop - scrollEl.clientHeight * 0.3),
      behavior: "smooth",
    });
  }, [onRevealHistory, scrollContainer]);

  // Keep the active entry visible in the panel list.
  useEffect(() => {
    if (activeIndex === null || !expanded) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded]);

  if (!expanded) {
    return (
      <div
        style={{
          width: COLLAPSED_WIDTH,
          flexShrink: 0,
          position: "relative",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          title="Show message navigator"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 4,
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = "var(--text-dim)";
            event.currentTarget.style.background = "none";
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        width: PANEL_WIDTH,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
          {entries.length} messages
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          title="Collapse navigator"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 4,
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = "var(--text-dim)";
            event.currentTarget.style.background = "none";
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {entries.map((entry, index) => {
          const isActive = activeIndex === index;
          return (
            <button
              key={index}
              type="button"
              onClick={() => scrollToEntry(index)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 7,
                width: "100%",
                padding: "7px 10px",
                paddingLeft: entry.role === "assistant" ? 24 : 10,
                background: isActive ? "color-mix(in srgb, var(--text) 6%, transparent)" : "transparent",
                border: "none",
                borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
                color: entry.role === "assistant" ? "var(--text-muted)" : "var(--text)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
                lineHeight: 1.45,
                transition: "background 100ms ease",
              }}
            >
              {entry.role === "user" ? <UserIcon /> : <SparkleIcon />}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                  overflowWrap: "anywhere",
                }}
              >
                {entry.text || "…"}
              </span>
            </button>
          );
        })}
        {entries.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>No messages yet</div>
        )}
      </div>
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
