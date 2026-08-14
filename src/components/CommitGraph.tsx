import {
  useMemo,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { CommitLogEntry } from "../lib/types";
import { Icon } from "./Icon";

const LANE_W = 19;
const ROW_H = 58;
const PAD_X = 12;
const PAD_Y = ROW_H / 2;
const DOT_R = 5;
const MAX_GRAPH_W = 180;

const COLORS = [
  "#5b8def",
  "#3ecf8e",
  "#e6b450",
  "#f07178",
  "#c792ea",
  "#89ddff",
  "#ffcb6b",
  "#82aaff",
  "#c3e88d",
  "#ff9cac",
];

export interface GraphNode {
  hash: string;
  row: number;
  col: number;
  color: number;
}

export interface GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
}

function layoutGraph(commits: CommitLogEntry[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  maxCol: number;
} {
  if (commits.length === 0) {
    return { nodes: [], edges: [], maxCol: 0 };
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // reserved[col] = hash that will next occupy this lane (a parent waiting to appear)
  const reserved: Array<string | null> = [];
  const nodeByHash = new Map<string, GraphNode>();

  const allocateLane = (hash: string): number => {
    const existing = reserved.indexOf(hash);
    if (existing >= 0) return existing;
    const empty = reserved.indexOf(null);
    if (empty >= 0) {
      reserved[empty] = hash;
      return empty;
    }
    reserved.push(hash);
    return reserved.length - 1;
  };

  for (let row = 0; row < commits.length; row++) {
    const c = commits[row];
    const parents = c.parents ?? [];

    let col = reserved.indexOf(c.hash);
    if (col < 0) {
      col = allocateLane(c.hash);
    }

    const color = col % COLORS.length;
    const node: GraphNode = { hash: c.hash, row, col, color };
    nodes.push(node);
    nodeByHash.set(c.hash, node);

    // First parent continues this lane; additional parents get their own lanes
    if (parents.length === 0) {
      reserved[col] = null;
    } else {
      reserved[col] = parents[0];
      for (let i = 1; i < parents.length; i++) {
        allocateLane(parents[i]);
      }
    }

    // Deduplicate: one lane per waiting parent hash (keep leftmost)
    const seen = new Map<string, number>();
    for (let i = 0; i < reserved.length; i++) {
      const h = reserved[i];
      if (!h) continue;
      if (seen.has(h)) {
        reserved[i] = null;
      } else {
        seen.set(h, i);
      }
    }

    // Trim trailing nulls
    while (reserved.length > 0 && reserved[reserved.length - 1] === null) {
      reserved.pop();
    }
  }

  // Edges: commit → each parent (parent appears later in topo/date order below)
  for (const node of nodes) {
    const c = commits[node.row];
    const parents = c.parents ?? [];
    for (let pi = 0; pi < parents.length; pi++) {
      const parentNode = nodeByHash.get(parents[pi]);
      if (!parentNode) continue;
      edges.push({
        x1: node.col,
        y1: node.row,
        x2: parentNode.col,
        y2: parentNode.row,
        color: pi === 0 ? node.color : parentNode.color,
      });
    }
  }

  const maxCol = Math.max(0, ...nodes.map((n) => n.col)) + 1;
  return { nodes, edges, maxCol };
}

function edgePath(e: GraphEdge, laneWidth: number): string {
  const x1 = PAD_X + e.x1 * laneWidth + laneWidth / 2;
  const y1 = PAD_Y + e.y1 * ROW_H;
  const x2 = PAD_X + e.x2 * laneWidth + laneWidth / 2;
  const y2 = PAD_Y + e.y2 * ROW_H;

  if (e.x1 === e.x2) {
    // Straight vertical
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  // Smooth fork / merge curve (SourceTree-ish)
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

type RefKind = "head" | "local" | "remote" | "tag" | "other";

interface ParsedRef {
  kind: RefKind;
  label: string;
}

const COMMIT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function parseRef(raw: string): ParsedRef {
  const typed = raw.match(/^(head|branch|remote|tag|other):(.*)$/);
  if (typed) {
    return {
      kind: typed[1] === "branch" ? "local" : (typed[1] as RefKind),
      label: typed[2].trim(),
    };
  }

  // Backwards compatibility for logs returned by an older running backend.
  if (raw.startsWith("HEAD→")) {
    return { kind: "head", label: raw.slice(5).trim() };
  }
  if (raw.startsWith("tag: ")) {
    return { kind: "tag", label: raw.slice(5).trim() };
  }
  if (/^(origin|upstream)\//.test(raw)) {
    return { kind: "remote", label: raw };
  }
  return { kind: "local", label: raw };
}

function refKindLabel(kind: RefKind): string {
  if (kind === "local") return "LOCAL";
  if (kind === "remote") return "REMOTE";
  if (kind === "tag") return "TAG";
  if (kind === "head") return "HEAD";
  return "REF";
}

function refTitle(ref: ParsedRef): string {
  const kind =
    ref.kind === "head"
      ? "Checked out branch"
      : ref.kind === "local"
        ? "Local branch"
        : ref.kind === "remote"
          ? "Remote branch"
          : ref.kind === "tag"
            ? "Tag"
            : "Git ref";
  return `${kind}: ${ref.label}`;
}

function formatCommitDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return COMMIT_DATE_FORMAT.format(date);
}

function CommitRefBadge({ raw, color }: { raw: string; color: string }) {
  const ref = parseRef(raw);
  return (
    <span
      className={`commit-ref-badge ref-${ref.kind}`}
      style={{ "--ref-color": color } as CSSProperties}
      title={refTitle(ref)}
    >
      {ref.kind === "local" || ref.kind === "head" ? (
        <Icon name="branch" size={12} className="commit-ref-icon" />
      ) : (
        <span className="commit-ref-symbol" aria-hidden>
          {ref.kind === "tag" ? "◆" : ref.kind === "remote" ? "⇄" : "•"}
        </span>
      )}
      <span className="commit-ref-kind">{refKindLabel(ref.kind)}</span>
      <span className="commit-ref-name">{ref.label}</span>
    </span>
  );
}

export function CommitGraph({
  commits,
  onSelect,
  selectedHash,
  actions,
  onContextMenu,
}: {
  commits: CommitLogEntry[];
  onSelect?: (c: CommitLogEntry) => void;
  selectedHash?: string | null;
  /** Optional per-row action buttons (history modal) */
  actions?: (c: CommitLogEntry) => ReactNode;
  onContextMenu?: (e: ReactMouseEvent, c: CommitLogEntry) => void;
}) {
  const { nodes, edges, maxCol } = useMemo(
    () => layoutGraph(commits),
    [commits],
  );
  const nodeByHash = useMemo(
    () => new Map(nodes.map((node) => [node.hash, node])),
    [nodes],
  );

  const naturalGraphW = Math.max(PAD_X * 2 + maxCol * LANE_W, 62);
  const graphW = Math.min(naturalGraphW, MAX_GRAPH_W);
  const laneWidth = Math.min(
    LANE_W,
    (graphW - PAD_X * 2) / Math.max(maxCol, 1),
  );
  const nodeRadius = Math.min(DOT_R, Math.max(1.75, laneWidth * 0.32));
  const graphH = PAD_Y * 2 + Math.max(commits.length - 1, 0) * ROW_H;
  const contentMinWidth = actions ? 650 : 510;

  if (commits.length === 0) {
    return <p className="muted">No commits</p>;
  }

  return (
    <div className="commit-graph">
      <div className="commit-graph-scroll">
        <div
          className={`commit-graph-header${actions ? " has-actions" : ""}`}
          style={{ minWidth: graphW + contentMinWidth }}
        >
          <span style={{ width: graphW }}>Graph</span>
          <span>Description</span>
          <span>Author</span>
          <span>Date</span>
          <span>Commit</span>
          {actions ? <span>Actions</span> : null}
        </div>
        <div
          className="commit-graph-inner"
          style={{
            minHeight: graphH,
            minWidth: graphW + contentMinWidth,
          }}
        >
          <svg
            className="commit-graph-svg"
            width={graphW}
            height={graphH}
            aria-hidden
          >
            {edges.map((e, i) => (
              <path
                key={i}
                d={edgePath(e, laneWidth)}
                fill="none"
                stroke={COLORS[e.color % COLORS.length]}
                strokeWidth={Math.min(2.25, Math.max(1.2, laneWidth * 0.18))}
                strokeLinecap="round"
                opacity={0.85}
              />
            ))}
            {nodes.map((n) => {
              const cx = PAD_X + n.col * laneWidth + laneWidth / 2;
              const cy = PAD_Y + n.row * ROW_H;
              const selected = selectedHash === n.hash;
              return (
                <circle
                  key={n.hash}
                  cx={cx}
                  cy={cy}
                  r={selected ? nodeRadius + 1.5 : nodeRadius}
                  fill={COLORS[n.color % COLORS.length]}
                  stroke={selected ? "#fff" : "rgba(0,0,0,0.35)"}
                  strokeWidth={selected ? 2 : 1}
                />
              );
            })}
          </svg>

          <div className="commit-graph-rows">
            {commits.map((c) => {
              const selected = selectedHash === c.hash;
              const node = nodeByHash.get(c.hash);
              const laneColor = COLORS[(node?.color ?? 0) % COLORS.length];
              const refs = c.refs ?? [];
              const exactDate = formatCommitDate(c.authoredAt);
              return (
                <div
                  key={c.hash}
                  className={`commit-graph-row${selected ? " selected" : ""}${
                    onSelect || onContextMenu ? " selectable" : ""
                  }`}
                  style={{ height: ROW_H }}
                  onClick={() => onSelect?.(c)}
                  onContextMenu={(e) => onContextMenu?.(e, c)}
                  onKeyDown={(event) => {
                    if (
                      onSelect &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onSelect(c);
                    }
                  }}
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                >
                  <div
                    className="commit-graph-spacer"
                    style={{ width: graphW }}
                  />
                  <div
                    className={`commit-graph-body${actions ? " has-actions" : ""}`}
                  >
                    <div className="commit-graph-description">
                      {refs.length > 0 ? (
                        <div className="commit-graph-refs">
                          {refs.slice(0, 6).map((ref) => (
                            <CommitRefBadge
                              key={ref}
                              raw={ref}
                              color={laneColor}
                            />
                          ))}
                          {refs.length > 6 ? (
                            <span
                              className="commit-ref-more"
                              title={refs
                                .slice(6)
                                .map((ref) => parseRef(ref).label)
                                .join(", ")}
                            >
                              +{refs.length - 6}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <span className="commit-graph-subject" title={c.subject}>
                        {c.subject}
                      </span>
                    </div>
                    <div className="commit-graph-author" title={c.author}>
                      {c.author}
                    </div>
                    <div
                      className="commit-graph-date"
                      title={exactDate ? `${exactDate} · ${c.when}` : c.when}
                    >
                      <span>{exactDate || c.when}</span>
                      {exactDate ? <small>{c.when}</small> : null}
                    </div>
                    <span className="mono history-hash" title={c.hash}>
                      {c.shortHash}
                    </span>
                    {actions ? (
                      <div
                        className="commit-graph-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {actions(c)}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
