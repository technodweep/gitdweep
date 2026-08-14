import { useEffect, useState } from "react";
import { readConflictFile, resolveConflict } from "../lib/api";
import type { ConflictStrategy, RepoStatus } from "../lib/types";

type Props = {
  repoId: string;
  files: string[];
  /** merge | rebase — affects help text labels for ours/theirs */
  mode: "merge" | "rebase";
  busy?: boolean;
  onStatus: (st: RepoStatus) => void;
  onToast: (msg: string, error?: boolean) => void;
};

export function ConflictPanel({
  repoId,
  files,
  mode,
  busy = false,
  onStatus,
  onToast,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [hasMarkers, setHasMarkers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (files.length === 0) {
      setSelected(null);
      setContent("");
      setHasMarkers(false);
      return;
    }
    if (!selected || !files.includes(selected)) {
      setSelected(files[0]);
    }
  }, [files, selected]);

  useEffect(() => {
    if (!selected) {
      setContent("");
      setHasMarkers(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void readConflictFile(repoId, selected)
      .then((view) => {
        if (cancelled) return;
        setContent(view.content);
        setHasMarkers(view.hasMarkers);
      })
      .catch((e) => {
        if (cancelled) return;
        setContent(`// Could not read file:\n${String(e)}`);
        setHasMarkers(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId, selected]);

  async function apply(strategy: ConflictStrategy) {
    if (!selected) return;
    setResolving(true);
    try {
      const st = await resolveConflict(repoId, selected, strategy);
      onStatus(st);
      const label =
        strategy === "ours"
          ? "Kept ours"
          : strategy === "theirs"
            ? "Kept theirs"
            : "Marked resolved";
      onToast(`${label}: ${selected}`);
      const remaining = st.conflictFiles ?? [];
      if (remaining.length > 0) {
        setSelected(remaining.includes(selected) ? selected : remaining[0]);
      } else {
        setSelected(null);
        setContent("");
        setHasMarkers(false);
      }
    } catch (e) {
      onToast(String(e), true);
    } finally {
      setResolving(false);
    }
  }

  const oursHint =
    mode === "rebase"
      ? "the branch you rebased onto (git --ours during rebase)"
      : "your current branch";
  const theirsHint =
    mode === "rebase"
      ? "the commit being replayed (git --theirs during rebase)"
      : "the branch being merged in";

  if (files.length === 0) {
    return (
      <div className="conflict-panel empty muted">
        No unresolved conflict files.
      </div>
    );
  }

  return (
    <div className="conflict-panel">
      <div className="conflict-files">
        <div className="conflict-files-head muted">
          Conflicted files ({files.length})
        </div>
        <ul className="conflict-file-list">
          {files.map((f) => (
            <li key={f}>
              <button
                type="button"
                className={`conflict-file-btn mono${
                  selected === f ? " active" : ""
                }`}
                disabled={busy || resolving}
                onClick={() => setSelected(f)}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="conflict-viewer">
        <div className="conflict-viewer-toolbar">
          <span className="mono conflict-viewer-path" title={selected ?? ""}>
            {selected ?? "—"}
          </span>
          {hasMarkers ? (
            <span className="badge warn">has markers</span>
          ) : selected ? (
            <span className="badge ok">no markers</span>
          ) : null}
        </div>
        <div className="conflict-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || resolving || !selected}
            title={`Use ${oursHint}`}
            onClick={() => void apply("ours")}
          >
            Keep ours
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || resolving || !selected}
            title={`Use ${theirsHint}`}
            onClick={() => void apply("theirs")}
          >
            Keep theirs
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy || resolving || !selected}
            title="Stage file as-is (after editing markers yourself)"
            onClick={() => void apply("mark_resolved")}
          >
            Mark resolved
          </button>
        </div>
        <p className="muted conflict-hint">
          <strong>Ours</strong> = {oursHint}. <strong>Theirs</strong> ={" "}
          {theirsHint}. Or edit the file in your editor (Folder), then Mark
          resolved.
        </p>
        <pre className="conflict-content mono">
          {loading ? "Loading…" : content || "(empty)"}
        </pre>
      </div>
    </div>
  );
}
