"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, CustomMessage, TextContent, UserMessage } from "@/lib/types";
import { splitFinalAssistantBlocks } from "@/lib/message-display";

export interface ChatMinimapProps {
  messages: AgentMessage[];
  streamingMessage?: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  visibleRefIndexByMessage?: Map<number, number>;
  onRevealHistory?: () => void;
}

export interface ChatTurn {
  turnIndex: number;
  userIdx: number;
  userMessage: AgentMessage;
  finalAssistantIdx: number;
  finalAssistantMessage: AssistantMessage | null;
  userText: string;
  assistantText: string;
  fullMarkdown: string;
}

const MINIMAP_WIDTH = 36;
const TRACK_PADDING_TOP = 20;
const TRACK_PADDING_BOTTOM = 20;

export function extractMessageText(message: AgentMessage | Partial<AgentMessage> | undefined | null): string {
  if (!message) return "";
  if (message.role === "user") {
    const userMsg = message as UserMessage;
    if (typeof userMsg.content === "string") return userMsg.content.trim();
    if (Array.isArray(userMsg.content)) {
      return userMsg.content
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }
    return "";
  }
  if (message.role === "assistant") {
    const asstMsg = message as AssistantMessage;
    const split = splitFinalAssistantBlocks(asstMsg);
    const answerBlocks = split.answerBlocks.length > 0 ? split.answerBlocks : (asstMsg.content ?? []);
    return answerBlocks
      .filter((b): b is TextContent => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  if (message.role === "custom") {
    const customMsg = message as CustomMessage;
    if (customMsg.customType === "compaction") {
      return typeof customMsg.content === "string" ? customMsg.content : "Session compacted";
    }
  }
  return "";
}

function isGroupAnchor(message: AgentMessage): boolean {
  if (message.role === "user") return true;
  return message.role === "custom" && (message as CustomMessage).customType === "compaction";
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    const msg = messages[candidateIdx];
    if (msg?.role === "assistant") {
      const split = splitFinalAssistantBlocks(msg as AssistantMessage);
      if (split.answerBlocks.some((b) => b.type === "image" || (b.type === "text" && b.text.trim().length > 0))) {
        return candidateIdx;
      }
    }
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

export function extractTurns(messages: AgentMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let turnNumber = 0;

  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (!isGroupAnchor(msg)) {
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) {
      endIdx += 1;
    }

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);
    const finalAssistantMessage = finalAssistantIdx !== -1 ? (messages[finalAssistantIdx] as AssistantMessage) : null;

    const userText = extractMessageText(msg);
    const assistantText = extractMessageText(finalAssistantMessage);

    let fullMarkdown = `### Turn ${turnNumber + 1}\n\n`;
    if (userText) fullMarkdown += `**User:**\n${userText}\n\n`;
    if (assistantText) fullMarkdown += `**Assistant:**\n${assistantText}\n\n`;

    turns.push({
      turnIndex: turnNumber,
      userIdx,
      userMessage: msg,
      finalAssistantIdx,
      finalAssistantMessage,
      userText,
      assistantText,
      fullMarkdown: fullMarkdown.trim(),
    });

    turnNumber += 1;
    idx = endIdx;
  }

  return turns;
}

export function ChatMinimap({
  messages,
  streamingMessage,
  scrollContainer,
  messageRefs,
  visibleRefIndexByMessage,
  onRevealHistory,
}: ChatMinimapProps) {
  const turns = useMemo(() => extractTurns(messages), [messages]);

  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null);
  const [copiedTurnIndex, setCopiedTurnIndex] = useState<number | null>(null);
  const [thumbState, setThumbState] = useState<{ top: number; height: number; visible: boolean }>({
    top: 0,
    height: 0,
    visible: false,
  });
  const [markerPositions, setMarkerPositions] = useState<number[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverLeaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggingThumbRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  // Measure marker positions and scroll thumb
  const updateLayout = useCallback(() => {
    const scrollEl = scrollContainer.current;
    const minimapEl = containerRef.current;
    if (!scrollEl || !minimapEl || turns.length === 0) {
      setThumbState({ top: 0, height: 0, visible: false });
      return;
    }

    const scrollHeight = scrollEl.scrollHeight;
    const clientHeight = scrollEl.clientHeight;
    const scrollTop = scrollEl.scrollTop;
    const trackHeight = minimapEl.clientHeight;

    const scrollableDistance = scrollHeight - clientHeight;
    const isScrollable = scrollableDistance > 10;

    // Calculate scroll thumb
    if (isScrollable && trackHeight > 0) {
      const thumbHeight = Math.max(28, (clientHeight / scrollHeight) * trackHeight);
      const availableTrack = trackHeight - thumbHeight;
      const thumbTop = (scrollTop / scrollableDistance) * availableTrack;
      setThumbState({
        top: Math.max(0, Math.min(thumbTop, availableTrack)),
        height: thumbHeight,
        visible: true,
      });
    } else {
      setThumbState({ top: 0, height: 0, visible: false });
    }

    // Calculate marker positions
    const refs = messageRefs.current;
    const availableHeight = trackHeight - (TRACK_PADDING_TOP + TRACK_PADDING_BOTTOM);

    const positions = turns.map((turn, index) => {
      let el: HTMLElement | null = null;

      // Try finding DOM element via visibleRefIndexByMessage
      if (visibleRefIndexByMessage) {
        const refIdx = visibleRefIndexByMessage.get(turn.userIdx);
        if (typeof refIdx === "number" && refs[refIdx]) {
          el = refs[refIdx];
        }
      }

      // Fallback: direct index scan
      if (!el && refs[turn.userIdx]) {
        el = refs[turn.userIdx];
      }

      if (el && scrollHeight > 0) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const elementAbsoluteTop = elRect.top - scrollRect.top + scrollEl.scrollTop;
        const ratio = Math.max(0, Math.min(1, elementAbsoluteTop / Math.max(1, scrollHeight)));
        return TRACK_PADDING_TOP + ratio * availableHeight;
      }

      // Fallback interpolation if element is lazy-unrendered
      const fallbackRatio = turns.length > 1 ? index / (turns.length - 1) : 0.5;
      return TRACK_PADDING_TOP + fallbackRatio * availableHeight;
    });

    setMarkerPositions(positions);

    // Sync active turn with scroll position
    const focusY = scrollTop + clientHeight * 0.35;
    let closestIndex = 0;
    let minDistance = Infinity;

    turns.forEach((turn, index) => {
      let el: HTMLElement | null = null;
      if (visibleRefIndexByMessage) {
        const refIdx = visibleRefIndexByMessage.get(turn.userIdx);
        if (typeof refIdx === "number" && refs[refIdx]) {
          el = refs[refIdx];
        }
      }
      if (!el && refs[turn.userIdx]) el = refs[turn.userIdx];

      if (el) {
        const scrollRect = scrollEl.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const elementAbsoluteTop = elRect.top - scrollRect.top + scrollEl.scrollTop;
        const dist = Math.abs(elementAbsoluteTop - focusY);
        if (dist < minDistance) {
          minDistance = dist;
          closestIndex = index;
        }
      } else {
        // Approximate distance
        const approxTop = (index / Math.max(1, turns.length)) * scrollHeight;
        const dist = Math.abs(approxTop - focusY);
        if (dist < minDistance) {
          minDistance = dist;
          closestIndex = index;
        }
      }
    });

    setActiveTurnIndex(closestIndex);
  }, [scrollContainer, messageRefs, turns, visibleRefIndexByMessage]);

  useEffect(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;

    const onScroll = () => {
      updateLayout();
    };

    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateLayout());
    ro.observe(scrollEl);

    updateLayout();

    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scrollContainer, updateLayout]);

  useEffect(() => {
    const timer = setTimeout(() => updateLayout(), 60);
    return () => clearTimeout(timer);
  }, [messages.length, streamingMessage, updateLayout]);

  const scrollToTurn = useCallback((turnIndex: number) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl || turnIndex < 0 || turnIndex >= turns.length) return;

    const turn = turns[turnIndex];
    if (!turn) return;

    let el: HTMLElement | null = null;
    const refs = messageRefs.current;
    if (visibleRefIndexByMessage) {
      const refIdx = visibleRefIndexByMessage.get(turn.userIdx);
      if (typeof refIdx === "number" && refs[refIdx]) {
        el = refs[refIdx];
      }
    }
    if (!el && refs[turn.userIdx]) el = refs[turn.userIdx];

    if (!el) {
      onRevealHistory?.();
      setTimeout(() => {
        const retryRefs = messageRefs.current;
        let retryEl: HTMLElement | null = null;
        if (visibleRefIndexByMessage) {
          const refIdx = visibleRefIndexByMessage.get(turn.userIdx);
          if (typeof refIdx === "number" && retryRefs[refIdx]) {
            retryEl = retryRefs[refIdx];
          }
        }
        if (!retryEl && retryRefs[turn.userIdx]) retryEl = retryRefs[turn.userIdx];
        if (retryEl) {
          retryEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 80);
      return;
    }

    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollContainer, turns, messageRefs, visibleRefIndexByMessage, onRevealHistory]);

  const handleMouseEnterRail = useCallback((turnIdx: number) => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    setHoveredTurnIndex(turnIdx);
  }, []);

  const handleMouseLeaveRail = useCallback(() => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHoveredTurnIndex(null);
    }, 250);
  }, []);

  const handleCardMouseEnter = useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
  }, []);

  const handleCardMouseLeave = useCallback(() => {
    if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHoveredTurnIndex(null);
    }, 200);
  }, []);

  const handleCopyTurn = useCallback(async (turn: ChatTurn, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const textToCopy = turn.userText || turn.assistantText || turn.fullMarkdown;
      await navigator.clipboard.writeText(textToCopy);
      setCopiedTurnIndex(turn.turnIndex);
      setTimeout(() => {
        setCopiedTurnIndex((cur) => (cur === turn.turnIndex ? null : cur));
      }, 1500);
    } catch {
      // ignore
    }
  }, []);

  const handleDownloadTurn = useCallback((turn: ChatTurn, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const blob = new Blob([turn.fullMarkdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chat-turn-${turn.turnIndex + 1}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, []);

  // Handle thumb dragging
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingThumbRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = scrollContainer.current?.scrollTop ?? 0;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingThumbRef.current || !scrollContainer.current || !containerRef.current) return;
      const deltaY = moveEvent.clientY - dragStartYRef.current;
      const trackHeight = containerRef.current.clientHeight;
      const scrollHeight = scrollContainer.current.scrollHeight;
      const clientHeight = scrollContainer.current.clientHeight;
      const scrollableDistance = scrollHeight - clientHeight;
      const thumbHeight = Math.max(28, (clientHeight / scrollHeight) * trackHeight);
      const availableTrack = trackHeight - thumbHeight;

      if (availableTrack > 0 && scrollableDistance > 0) {
        const scrollDelta = (deltaY / availableTrack) * scrollableDistance;
        scrollContainer.current.scrollTop = dragStartScrollTopRef.current + scrollDelta;
      }
    };

    const onMouseUp = () => {
      isDraggingThumbRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [scrollContainer]);

  if (turns.length === 0) {
    return null;
  }

  const selectedTurnIndex = hoveredTurnIndex !== null ? hoveredTurnIndex : activeTurnIndex;
  const currentCardTurn = selectedTurnIndex !== null && turns[selectedTurnIndex] ? turns[selectedTurnIndex] : null;

  // Calculate card position
  let cardTop = 20;
  if (selectedTurnIndex !== null && markerPositions[selectedTurnIndex] !== undefined) {
    const rawMarkerY = markerPositions[selectedTurnIndex];
    const containerH = containerRef.current?.clientHeight ?? 600;
    cardTop = Math.max(12, Math.min(containerH - 140, rawMarkerY - 45));
  }

  return (
    <div
      ref={containerRef}
      className="chat-minimap-rail"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: MINIMAP_WIDTH,
        zIndex: 35,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "auto",
        userSelect: "none",
      }}
      onMouseLeave={handleMouseLeaveRail}
    >
      {/* Center rail line */}
      <div
        style={{
          position: "absolute",
          top: TRACK_PADDING_TOP,
          bottom: TRACK_PADDING_BOTTOM,
          left: "50%",
          width: 1,
          transform: "translateX(-50%)",
          background: "color-mix(in srgb, var(--border) 60%, transparent)",
          pointerEvents: "none",
        }}
      />

      {/* Viewport Scrollbar Thumb */}
      {thumbState.visible && (
        <div
          onMouseDown={handleThumbMouseDown}
          title="Drag to scroll"
          style={{
            position: "absolute",
            top: thumbState.top,
            height: thumbState.height,
            right: 4,
            width: 4,
            borderRadius: 9999,
            background: "color-mix(in srgb, var(--text-muted) 35%, transparent)",
            cursor: "grab",
            transition: "background 150ms ease, width 150ms ease",
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "color-mix(in srgb, var(--text-muted) 65%, transparent)";
            e.currentTarget.style.width = "6px";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "color-mix(in srgb, var(--text-muted) 35%, transparent)";
            e.currentTarget.style.width = "4px";
          }}
        />
      )}

      {/* Turn Markers */}
      {turns.map((turn, idx) => {
        const markerY = markerPositions[idx] ?? (TRACK_PADDING_TOP + idx * 24);
        const isActive = activeTurnIndex === idx;
        const isHovered = hoveredTurnIndex === idx;

        return (
          <button
            key={turn.turnIndex}
            type="button"
            onClick={() => scrollToTurn(idx)}
            onMouseEnter={() => handleMouseEnterRail(idx)}
            title={`Jump to turn ${idx + 1}`}
            aria-label={`Jump to turn ${idx + 1}: ${turn.userText.slice(0, 40)}`}
            style={{
              position: "absolute",
              top: markerY,
              left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              padding: 0,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              zIndex: isActive || isHovered ? 4 : 2,
            }}
          >
            {isActive ? (
              // Active pill indicator (Google AI Studio style)
              <span
                style={{
                  display: "block",
                  width: 3.5,
                  height: 18,
                  borderRadius: 9999,
                  background: "var(--accent)",
                  boxShadow: "0 0 8px color-mix(in srgb, var(--accent) 60%, transparent)",
                  transition: "all 160ms cubic-bezier(0.4, 0, 0.2, 1)",
                  transform: isHovered ? "scaleY(1.15) scaleX(1.3)" : "none",
                }}
              />
            ) : (
              // Normal dot indicator
              <span
                style={{
                  display: "block",
                  width: isHovered ? 7 : 5,
                  height: isHovered ? 7 : 5,
                  borderRadius: "50%",
                  background: isHovered ? "var(--text)" : "color-mix(in srgb, var(--text-dim) 80%, transparent)",
                  transition: "all 140ms ease",
                  boxShadow: isHovered ? "0 0 6px rgba(0,0,0,0.2)" : "none",
                }}
              />
            )}
          </button>
        );
      })}

      {/* Floating Preview Card (Google AI Studio Card) */}
      {hoveredTurnIndex !== null && currentCardTurn && (
        <div
          onMouseEnter={handleCardMouseEnter}
          onMouseLeave={handleCardMouseLeave}
          onClick={() => scrollToTurn(currentCardTurn.turnIndex)}
          style={{
            position: "absolute",
            right: MINIMAP_WIDTH + 4,
            top: cardTop,
            width: 280,
            maxWidth: "calc(100vw - 120px)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 4px 20px -2px rgba(0, 0, 0, 0.25), 0 2px 6px -1px rgba(0, 0, 0, 0.12)",
            padding: "10px 12px",
            zIndex: 50,
            cursor: "pointer",
            backdropFilter: "blur(12px)",
            animation: "minimap-pop 0.14s cubic-bezier(0.16, 1, 0.3, 1)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {/* Card Header with Turn number and Action buttons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
              paddingBottom: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                #{currentCardTurn.turnIndex + 1}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {currentCardTurn.assistantText ? "Q&A" : "Prompt"}
              </span>
            </div>

            {/* Action buttons (Download, Copy, Prev, Next) */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Download / Export Button */}
              <button
                type="button"
                onClick={(e) => handleDownloadTurn(currentCardTurn, e)}
                title="Export this turn as markdown"
                aria-label="Export turn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>

              {/* Copy Button */}
              <button
                type="button"
                onClick={(e) => handleCopyTurn(currentCardTurn, e)}
                title={copiedTurnIndex === currentCardTurn.turnIndex ? "Copied!" : "Copy message text"}
                aria-label="Copy text"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: copiedTurnIndex === currentCardTurn.turnIndex ? "#10b981" : "var(--text-muted)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  if (copiedTurnIndex !== currentCardTurn.turnIndex) {
                    e.currentTarget.style.color = "var(--text)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (copiedTurnIndex !== currentCardTurn.turnIndex) {
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                {copiedTurnIndex === currentCardTurn.turnIndex ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>

              {/* Prev Turn Button */}
              <button
                type="button"
                disabled={currentCardTurn.turnIndex <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentCardTurn.turnIndex > 0) {
                    scrollToTurn(currentCardTurn.turnIndex - 1);
                    setHoveredTurnIndex(currentCardTurn.turnIndex - 1);
                  }
                }}
                title="Previous turn"
                aria-label="Previous turn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: currentCardTurn.turnIndex <= 0 ? "var(--text-dim)" : "var(--text-muted)",
                  cursor: currentCardTurn.turnIndex <= 0 ? "default" : "pointer",
                  opacity: currentCardTurn.turnIndex <= 0 ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (currentCardTurn.turnIndex > 0) {
                    e.currentTarget.style.color = "var(--text)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentCardTurn.turnIndex > 0) {
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>

              {/* Next Turn Button */}
              <button
                type="button"
                disabled={currentCardTurn.turnIndex >= turns.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentCardTurn.turnIndex < turns.length - 1) {
                    scrollToTurn(currentCardTurn.turnIndex + 1);
                    setHoveredTurnIndex(currentCardTurn.turnIndex + 1);
                  }
                }}
                title="Next turn"
                aria-label="Next turn"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 24,
                  height: 24,
                  padding: 0,
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  color: currentCardTurn.turnIndex >= turns.length - 1 ? "var(--text-dim)" : "var(--text-muted)",
                  cursor: currentCardTurn.turnIndex >= turns.length - 1 ? "default" : "pointer",
                  opacity: currentCardTurn.turnIndex >= turns.length - 1 ? 0.4 : 1,
                }}
                onMouseEnter={(e) => {
                  if (currentCardTurn.turnIndex < turns.length - 1) {
                    e.currentTarget.style.color = "var(--text)";
                    e.currentTarget.style.background = "var(--bg-hover)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentCardTurn.turnIndex < turns.length - 1) {
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.background = "transparent";
                  }
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>

          {/* Card Body - Message Text Snippet */}
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.45,
              color: "var(--text)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              wordBreak: "break-word",
            }}
          >
            {currentCardTurn.userText ? (
              <span>
                <strong style={{ fontWeight: 600, color: "var(--text-muted)", marginRight: 4 }}>
                  {currentCardTurn.turnIndex + 1}.
                </strong>
                {currentCardTurn.userText}
              </span>
            ) : currentCardTurn.assistantText ? (
              <span>{currentCardTurn.assistantText}</span>
            ) : (
              <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>[Empty message]</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Hook to maintain refs array for message nodes
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
