import { useMemo, useState } from "react";

export type DiffLineKind = "add" | "del" | "ctx";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  /** Human summary e.g. "Lines −42,+48" */
  summary: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  adds: number;
  dels: number;
}

export interface DiffBlock {
  /** staged | unstaged | untracked | changes */
  label: string;
  hunks: DiffHunk[];
  /** leftover meta lines (for raw view) */
  meta: string[];
}

function parseHunkHeader(header: string): {
  oldStart: number;
  newStart: number;
  summary: string;
} {
  // @@ -12,5 +14,8 @@ optional context
  const m = header.match(
    /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@(.*)$/,
  );
  if (!m) {
    return { oldStart: 0, newStart: 0, summary: header };
  }
  const oldStart = Number(m[1]);
  const oldLen = m[2] != null ? Number(m[2]) : 1;
  const newStart = Number(m[3]);
  const newLen = m[4] != null ? Number(m[4]) : 1;
  const ctx = (m[5] || "").trim();
  const range =
    oldLen === newLen
      ? `around line ${newStart}`
      : `−${oldLen} / +${newLen} lines @ ${newStart}`;
  const summary = ctx ? `${range} · ${ctx}` : range;
  return { oldStart, newStart, summary };
}

function isMetaLine(line: string): boolean {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode") ||
    line.startsWith("old mode") ||
    line.startsWith("new mode") ||
    line.startsWith("similarity index") ||
    line.startsWith("rename from") ||
    line.startsWith("rename to") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("Binary files") ||
    line.startsWith("\\ No newline")
  );
}

function parseSectionBody(body: string): {
  hunks: DiffHunk[];
  meta: string[];
} {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const hunks: DiffHunk[] = [];
  const meta: string[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };

  const ensureSyntheticHunk = () => {
    if (current) return;
    current = {
      header: "@@",
      summary: "Changes",
      oldStart: 0,
      newStart: 1,
      lines: [],
      adds: 0,
      dels: 0,
    };
    oldNo = 0;
    newNo = 1;
  };

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      flush();
      const { oldStart, newStart, summary } = parseHunkHeader(raw);
      oldNo = oldStart;
      newNo = newStart;
      current = {
        header: raw,
        summary,
        oldStart,
        newStart,
        lines: [],
        adds: 0,
        dels: 0,
      };
      continue;
    }

    // Git meta headers — hide in formatted view
    if (isMetaLine(raw)) {
      if (raw.trim()) meta.push(raw);
      continue;
    }

    if (raw.startsWith("\\")) {
      if (raw.trim()) meta.push(raw);
      continue;
    }

    if (raw.startsWith("+")) {
      ensureSyntheticHunk();
      current!.lines.push({
        kind: "add",
        text: raw.slice(1),
        oldNo: null,
        newNo: newNo++,
      });
      current!.adds += 1;
      continue;
    }

    if (raw.startsWith("-")) {
      ensureSyntheticHunk();
      current!.lines.push({
        kind: "del",
        text: raw.slice(1),
        oldNo: oldNo++,
        newNo: null,
      });
      current!.dels += 1;
      continue;
    }

    if (raw.startsWith(" ") || raw === "") {
      if (!current) {
        // ignore leading blank lines before first hunk
        if (raw === "") continue;
        ensureSyntheticHunk();
      }
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      current!.lines.push({
        kind: "ctx",
        text,
        oldNo: oldNo++,
        newNo: newNo++,
      });
      continue;
    }

    if (raw.trim()) meta.push(raw);
  }
  flush();
  return { hunks, meta };
}

/** Split backend sections and parse hunks. */
export function parseDiffBlocks(diffText: string): DiffBlock[] {
  if (!diffText.trim()) return [];

  const text = diffText.replace(/\r\n/g, "\n");
  const sectionSplit = text.split(/(?=^--- (?:staged|unstaged) ---$)/m);
  const blocks: DiffBlock[] = [];

  for (const part of sectionSplit) {
    if (!part.trim()) continue;
    let label = "Changes";
    let body = part;

    const staged = part.match(/^--- staged ---\n?([\s\S]*)/);
    const unstaged = part.match(/^--- unstaged ---\n?([\s\S]*)/);
    if (staged) {
      label = "Staged";
      body = staged[1];
    } else if (unstaged) {
      label = "Unstaged";
      body = unstaged[1];
    } else if (part.startsWith("Untracked file:")) {
      label = "Untracked (new file)";
      // Convert "+line" dump into a synthetic hunk
      const lines = part.split("\n").slice(1);
      const hunkLines: DiffLine[] = [];
      let n = 1;
      for (const raw of lines) {
        if (!raw) continue;
        const textLine = raw.startsWith("+") ? raw.slice(1) : raw;
        hunkLines.push({
          kind: "add",
          text: textLine,
          oldNo: null,
          newNo: n++,
        });
      }
      blocks.push({
        label,
        meta: [part.split("\n")[0]],
        hunks: [
          {
            header: "@@",
            summary: "New file content",
            oldStart: 0,
            newStart: 1,
            lines: hunkLines,
            adds: hunkLines.length,
            dels: 0,
          },
        ],
      });
      continue;
    }

    const { hunks, meta } = parseSectionBody(body);
    if (hunks.length === 0 && !meta.length) continue;
    blocks.push({ label, hunks, meta });
  }

  // Fallback: whole text as one block
  if (blocks.length === 0) {
    const { hunks, meta } = parseSectionBody(text);
    blocks.push({ label: "Changes", hunks, meta });
  }

  return blocks;
}

function totalStats(blocks: DiffBlock[]): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const b of blocks) {
    for (const h of b.hunks) {
      adds += h.adds;
      dels += h.dels;
    }
  }
  return { adds, dels };
}

function RawDiff({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div className="diff-lines raw">
      {lines.map((raw, i) => {
        let cls = "ctx";
        let marker = " ";
        let content = raw;
        if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("index ")) {
          cls = "meta";
        } else if (raw.startsWith("@@")) {
          cls = "hunk";
          marker = "@";
        } else if (raw.startsWith("+")) {
          cls = "add";
          marker = "+";
          content = raw.slice(1);
        } else if (raw.startsWith("-")) {
          cls = "del";
          marker = "−";
          content = raw.slice(1);
        } else if (raw.startsWith(" ")) {
          content = raw.slice(1);
        }
        return (
          <div key={i} className={`diff-line ${cls}`}>
            <span className="diff-gutter">{marker}</span>
            <span className="diff-code">{content || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

function FormattedDiff({ blocks }: { blocks: DiffBlock[] }) {
  return (
    <div className="diff-formatted">
      {blocks.map((block, bi) => (
        <div key={bi} className="diff-block">
          {blocks.length > 1 || block.label !== "Changes" ? (
            <div className="diff-block-label">{block.label}</div>
          ) : null}

          {block.hunks.length === 0 ? (
            <div className="diff-empty-hint" style={{ padding: "0.75rem" }}>
              No line changes in this section
              {block.meta.length > 0 ? " (binary or rename only)." : "."}
            </div>
          ) : (
            block.hunks.map((hunk, hi) => (
              <div key={hi} className="diff-hunk">
                <div className="diff-hunk-header">
                  <span className="diff-hunk-title">{hunk.summary}</span>
                  <span className="diff-hunk-stats">
                    <span className="diff-stat add">+{hunk.adds}</span>
                    <span className="diff-stat del">−{hunk.dels}</span>
                  </span>
                </div>
                <div className="diff-lines">
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`diff-line ${line.kind}`}>
                      <span className="diff-ln old" aria-hidden>
                        {line.oldNo ?? ""}
                      </span>
                      <span className="diff-ln new" aria-hidden>
                        {line.newNo ?? ""}
                      </span>
                      <span className="diff-gutter" aria-hidden>
                        {line.kind === "add"
                          ? "+"
                          : line.kind === "del"
                            ? "−"
                            : " "}
                      </span>
                      <span className="diff-code">{line.text || " "}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}

export function DiffView({
  filePath,
  diffText,
  loading,
}: {
  filePath?: string | null;
  diffText: string;
  loading?: boolean;
}) {
  const [mode, setMode] = useState<"formatted" | "raw">("formatted");

  const blocks = useMemo(() => parseDiffBlocks(diffText), [diffText]);
  const stats = useMemo(() => totalStats(blocks), [blocks]);
  const hasContent =
    blocks.some((b) => b.hunks.some((h) => h.lines.length > 0)) ||
    diffText.trim().length > 0;

  if (loading) {
    return (
      <div className="diff-view diff-view-empty">
        <div className="diff-empty-title">Loading changes…</div>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="diff-view diff-view-empty">
        <div className="diff-empty-title">No file selected</div>
        <p className="diff-empty-hint">
          Click a file on the left to preview its changes.
        </p>
        <div className="diff-legend">
          <span className="diff-legend-item add">
            <span className="diff-swatch add" /> Green = added
          </span>
          <span className="diff-legend-item del">
            <span className="diff-swatch del" /> Red = removed
          </span>
          <span className="diff-legend-item ctx">
            <span className="diff-swatch ctx" /> Gray = unchanged context
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <div className="diff-view-header">
        <div className="diff-view-header-row">
          <div className="diff-view-title" title={filePath}>
            {filePath.split(/[/\\]/).pop() ?? filePath}
          </div>
          <div className="diff-mode-toggle" role="group" aria-label="Diff view mode">
            <button
              type="button"
              className={`diff-mode-btn${mode === "formatted" ? " active" : ""}`}
              onClick={() => setMode("formatted")}
            >
              Formatted
            </button>
            <button
              type="button"
              className={`diff-mode-btn${mode === "raw" ? " active" : ""}`}
              onClick={() => setMode("raw")}
            >
              Raw
            </button>
          </div>
        </div>
        <div className="diff-view-path mono muted">{filePath}</div>
        <div className="diff-stats">
          <span className="diff-stat add">+{stats.adds} added</span>
          <span className="diff-stat del">−{stats.dels} removed</span>
        </div>
      </div>

      {!hasContent ? (
        <div className="diff-view-empty inner">
          <p className="diff-empty-hint">
            No line-by-line changes to show (binary file, empty, or matches
            index).
          </p>
        </div>
      ) : mode === "formatted" ? (
        <div className="diff-scroll">
          <FormattedDiff blocks={blocks} />
        </div>
      ) : (
        <div className="diff-scroll">
          <RawDiff text={diffText} />
        </div>
      )}
    </div>
  );
}
