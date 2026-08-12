import { useMemo, type ReactNode } from "react";
import type { CommitLogEntry } from "../lib/types";

const LANE_W = 16;
const ROW_H = 44;
const PAD_X = 10;
const PAD_Y = 14;
const DOT_R = 4.5;

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

function edgePath(
  e: GraphEdge,
  maxCol: number,
): string {
  const x1 = PAD_X + e.x1 * LANE_W + LANE_W / 2;
  const y1 = PAD_Y + e.y1 * ROW_H;
  const x2 = PAD_X + e.x2 * LANE_W + LANE_W / 2;
  const y2 = PAD_Y + e.y2 * ROW_H;

  if (e.x1 === e.x2) {
    // Straight vertical
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  // Smooth fork / merge curve (SourceTree-ish)
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function CommitGraph({
  commits,
  onSelect,
  selectedHash,
  actions,
}: {
  commits: CommitLogEntry[];
  onSelect?: (c: CommitLogEntry) => void;
  selectedHash?: string | null;
  /** Optional per-row action buttons (history modal) */
  actions?: (c: CommitLogEntry) => ReactNode;
}) {
  const { nodes, edges, maxCol } = useMemo(
    () => layoutGraph(commits),
    [commits],
  );

  const graphW = Math.max(PAD_X * 2 + maxCol * LANE_W, 48);
  const graphH = PAD_Y * 2 + Math.max(commits.length - 1, 0) * ROW_H;

  if (commits.length === 0) {
    return <p className="muted">No commits</p>;
  }

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.hash, n);
    return m;
  }, [nodes]);

  return (
    <div className="commit-graph">
      <div className="commit-graph-scroll">
        <div
          className="commit-graph-inner"
          style={{ minHeight: graphH + ROW_H }}
        >
          <svg
            className="commit-graph-svg"
            width={graphW}
            height={graphH + ROW_H / 2}
            aria-hidden
          >
            {edges.map((e, i) => (
              <path
                key={i}
                d={edgePath(e, maxCol)}
                fill="none"
                stroke={COLORS[e.color % COLORS.length]}
                strokeWidth={2}
                strokeLinecap="round"
                opacity={0.85}
              />
            ))}
            {nodes.map((n) => {
              const cx = PAD_X + n.col * LANE_W + LANE_W / 2;
              const cy = PAD_Y + n.row * ROW_H;
              const selected = selectedHash === n.hash;
              return (
                <circle
                  key={n.hash}
                  cx={cx}
                  cy={cy}
                  r={selected ? DOT_R + 1.5 : DOT_R}
                  fill={COLORS[n.color % COLORS.length]}
                  stroke={selected ? "#fff" : "rgba(0,0,0,0.35)"}
                  strokeWidth={selected ? 2 : 1}
                />
              );
            })}
          </svg>

          <div className="commit-graph-rows">
            {commits.map((c) => {
              const n = nodeMap.get(c.hash);
              const selected = selectedHash === c.hash;
              return (
                <div
                  key={c.hash}
                  className={`commit-graph-row${selected ? " selected" : ""}`}
                  style={{ height: ROW_H }}
                  onClick={() => onSelect?.(c)}
                >
                  <div
                    className="commit-graph-spacer"
                    style={{ width: graphW }}
                  />
                  <div className="commit-graph-body">
                    <div className="commit-graph-subject-line">
                      <span className="mono history-hash" title={c.hash}>
                        {c.shortHash}
                      </span>
                      <span className="commit-graph-subject">{c.subject}</span>
                      {(c.refs ?? []).slice(0, 4).map((r) => (
                        <span key={r} className="commit-ref-badge" title={r}>
                          {r.length > 28 ? `${r.slice(0, 26)}…` : r}
                        </span>
                      ))}
                    </div>
                    <div className="muted commit-graph-meta">
                      {c.author} · {c.when}
                    </div>
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
