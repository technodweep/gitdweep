import { useEffect, useMemo, useState } from "react";
import type { BranchInfo, ChangedFile, Repo, RepoStatus } from "../lib/types";
import {
  copyToClipboard,
  useContextMenu,
  type ContextMenuItem,
} from "./ContextMenu";
import { Icon } from "./Icon";

export type InspectorSection = "worktree" | "branches" | "merge";

export type InspectorMergeOptions = {
  noFf?: boolean;
  squash?: boolean;
};

type Props = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  repo: Repo | null;
  status?: RepoStatus;
  branches: BranchInfo[];
  files: ChangedFile[];
  filesLoading: boolean;
  busy?: boolean;
  mergeBusy?: boolean;
  onRefreshFiles: () => void;
  onOpenStage: () => void;
  onCheckout: (branch: string) => void;
  onOpenBranches: () => void;
  onFetch: () => void;
  /** Quick or form merge into the current branch */
  onMerge: (sourceBranch: string, options: InspectorMergeOptions) => void;
  onAbortMerge: () => void;
  /** Open full merge modal (conflict UI, etc.) */
  onOpenMergeModal: (preselect?: string) => void;
  onRebase?: (ontoBranch: string) => void;
  onOpenFolder?: () => void;
  onOpenHistory?: () => void;
  onPull?: () => void;
  onPush?: () => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onDiscardFile?: (path: string) => void;
  onToast?: (msg: string, error?: boolean) => void;
};

function SyncBadge({ branch }: { branch: BranchInfo }) {
  if (branch.kind !== "local") return null;
  if (branch.upstreamGone) {
    return (
      <span className="sync-badge gone" title="Upstream is gone">
        gone
      </span>
    );
  }
  if (!branch.upstream) {
    return (
      <span className="sync-badge none" title="No upstream configured">
        no ↑
      </span>
    );
  }
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (ahead === 0 && behind === 0) {
    return (
      <span className="sync-badge clean" title={`In sync with ${branch.upstream}`}>
        ✓
      </span>
    );
  }
  return (
    <span
      className={`sync-badge drift${behind > 0 ? " behind" : ""}`}
      title={`${branch.upstream}: ahead ${ahead}, behind ${behind}`}
    >
      {ahead > 0 ? <span className="sync-ahead">↑{ahead}</span> : null}
      {behind > 0 ? <span className="sync-behind">↓{behind}</span> : null}
    </span>
  );
}

export function RepoInspector({
  collapsed,
  onToggleCollapsed,
  repo,
  status,
  branches,
  files,
  filesLoading,
  busy = false,
  mergeBusy = false,
  onRefreshFiles,
  onOpenStage,
  onCheckout,
  onOpenBranches,
  onFetch,
  onMerge,
  onAbortMerge,
  onOpenMergeModal,
  onRebase,
  onOpenFolder,
  onOpenHistory,
  onPull,
  onPush,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onToast,
}: Props) {
  const { open: openCtx, menuNode: ctxMenu } = useContextMenu();
  const [section, setSection] = useState<InspectorSection>("branches");
  const [branchFilter, setBranchFilter] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeNoFf, setMergeNoFf] = useState(false);
  const [mergeSquash, setMergeSquash] = useState(false);

  async function copyText(text: string, label: string) {
    const ok = await copyToClipboard(text);
    onToast?.(ok ? `Copied ${label}` : "Could not copy", !ok);
  }

  function branchMenuItems(b: BranchInfo): ContextMenuItem[] {
    const current = !!b.isCurrent;
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: b.name },
    ];
    if (!current) {
      items.push({
        id: "checkout",
        label: "Checkout",
        disabled: locked,
        onSelect: () => onCheckout(b.name),
      });
      items.push({
        id: "merge",
        label: "Merge into current…",
        disabled: locked || isMerging || !!status?.isDirty,
        onSelect: () => runMerge(b.name),
      });
      if (onRebase) {
        items.push({
          id: "rebase",
          label: "Rebase current onto this…",
          disabled: locked || isMerging || !!status?.isDirty,
          onSelect: () => onRebase(b.name),
        });
      }
      items.push({ type: "separator", id: "s1" });
    }
    items.push({
      id: "copy",
      label: "Copy branch name",
      onSelect: () => void copyText(b.name, "branch name"),
    });
    if (b.upstream) {
      items.push({
        id: "copy-up",
        label: "Copy upstream",
        onSelect: () => void copyText(b.upstream!, "upstream"),
      });
    }
    return items;
  }

  function fileMenuItems(f: ChangedFile): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: f.path },
    ];
    if (f.unstaged && onStageFile) {
      items.push({
        id: "stage",
        label: "Stage",
        disabled: busy,
        onSelect: () => onStageFile(f.path),
      });
    }
    if (f.staged && onUnstageFile) {
      items.push({
        id: "unstage",
        label: "Unstage",
        disabled: busy,
        onSelect: () => onUnstageFile(f.path),
      });
    }
    if (onDiscardFile) {
      items.push({
        id: "discard",
        label: "Discard changes…",
        danger: true,
        disabled: busy,
        onSelect: () => onDiscardFile(f.path),
      });
    }
    items.push({ type: "separator", id: "s1" });
    items.push({
      id: "stage-modal",
      label: "Open in stage / commit…",
      onSelect: () => onOpenStage(),
    });
    items.push({
      id: "copy",
      label: "Copy path",
      onSelect: () => void copyText(f.path, "path"),
    });
    return items;
  }

  function repoHeaderMenuItems(): ContextMenuItem[] {
    if (!repo) return [];
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: repo.name },
      {
        id: "fetch",
        label: "Fetch",
        disabled: busy,
        onSelect: () => onFetch(),
      },
    ];
    if (onPull) {
      items.push({
        id: "pull",
        label: "Pull",
        disabled: busy,
        onSelect: () => onPull(),
      });
    }
    if (onPush) {
      items.push({
        id: "push",
        label: "Push",
        disabled: busy,
        onSelect: () => onPush(),
      });
    }
    items.push({ type: "separator", id: "s1" });
    items.push({
      id: "stage",
      label: "Stage & commit…",
      disabled: busy,
      onSelect: () => onOpenStage(),
    });
    items.push({
      id: "branches",
      label: "Manage branches…",
      onSelect: () => onOpenBranches(),
    });
    if (onOpenHistory) {
      items.push({
        id: "history",
        label: "History…",
        onSelect: () => onOpenHistory(),
      });
    }
    items.push({
      id: "merge-tab",
      label: "Merge…",
      onSelect: () => setSection("merge"),
    });
    if (onOpenFolder) {
      items.push({ type: "separator", id: "s2" });
      items.push({
        id: "folder",
        label: "Open folder",
        onSelect: () => onOpenFolder(),
      });
    }
    items.push({
      id: "copy-path",
      label: "Copy path",
      onSelect: () => void copyText(repo.path, "path"),
    });
    return items;
  }

  const currentBranch = status?.currentBranch ?? null;
  const isMerging = !!status?.isMerging;
  const conflictCount = status?.conflictFiles?.length ?? 0;
  const locked = busy || mergeBusy || !!status?.isDetached;

  const localBranches = useMemo(() => {
    const q = branchFilter.trim().toLowerCase();
    let list = branches.filter((b) => b.kind === "local");
    if (q) list = list.filter((b) => b.name.toLowerCase().includes(q));
    return [...list].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const ab = a.behind ?? 0;
      const bb = b.behind ?? 0;
      if (ab !== bb) return bb - ab;
      return a.name.localeCompare(b.name);
    });
  }, [branches, branchFilter]);

  const mergeCandidates = useMemo(() => {
    return branches.filter((b) => {
      if (b.kind === "local") {
        return b.name !== currentBranch && !b.isCurrent;
      }
      return true;
    });
  }, [branches, currentBranch]);

  const remoteCount = useMemo(
    () => branches.filter((b) => b.kind === "remote").length,
    [branches],
  );

  const pullsSummary = useMemo(() => {
    let behind = 0;
    let ahead = 0;
    for (const b of branches) {
      if (b.kind !== "local") continue;
      if ((b.behind ?? 0) > 0) behind += 1;
      if ((b.ahead ?? 0) > 0) ahead += 1;
    }
    return { behind, ahead };
  }, [branches]);

  // Prefill merge source when opening merge tab or branch list changes
  useEffect(() => {
    if (mergeSource && mergeCandidates.some((b) => b.name === mergeSource)) {
      return;
    }
    const first = mergeCandidates[0];
    setMergeSource(first?.name ?? "");
  }, [mergeCandidates, mergeSource, repo?.id]);

  // When a merge is in progress, surface the Merge tab
  useEffect(() => {
    if (isMerging) setSection("merge");
  }, [isMerging, repo?.id]);

  const staged = files.filter((f) => f.staged).length;
  const unstaged = files.filter((f) => f.unstaged).length;

  function runMerge(source: string) {
    if (!source) return;
    onMerge(source, {
      noFf: mergeNoFf && !mergeSquash,
      squash: mergeSquash,
    });
  }

  if (collapsed) {
    return (
      <aside className="repo-inspector collapsed" aria-label="Repo inspector">
        <button
          type="button"
          className="inspector-expand-btn"
          onClick={onToggleCollapsed}
          title="Expand worktree & branches"
          aria-label="Expand worktree and branches panel"
        >
          <Icon name="sidebar-expand" size={16} />
          <span className="inspector-rail-label">Inspect</span>
          {isMerging ? (
            <span className="inspector-rail-badge" title="Merge in progress">
              M
            </span>
          ) : null}
          {pullsSummary.behind > 0 ? (
            <span className="inspector-rail-badge" title="Local branches behind remote">
              ↓{pullsSummary.behind}
            </span>
          ) : null}
          {files.length > 0 ? (
            <span
              className="inspector-rail-badge dirty"
              title={`${files.length} changed file(s)`}
            >
              {files.length}
            </span>
          ) : null}
        </button>
      </aside>
    );
  }

  return (
    <aside className="repo-inspector" aria-label="Repo inspector">
      {ctxMenu}
      <div
        className="inspector-header"
        onContextMenu={(e) => openCtx(e, repoHeaderMenuItems())}
      >
        <div className="inspector-header-text">
          <span className="eyebrow">Inspector</span>
          <strong className="inspector-repo-name" title={repo?.path}>
            {repo?.name ?? "No repo selected"}
          </strong>
          {currentBranch ? (
            <span className="muted mono inspector-current">
              {currentBranch}
              {status?.isDirty ? " · dirty" : " · clean"}
              {isMerging ? " · merging" : ""}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={onToggleCollapsed}
          aria-label="Collapse inspector"
          title="Collapse panel"
        >
          <Icon name="sidebar-collapse" size={16} />
        </button>
      </div>

      {!repo ? (
        <div className="inspector-empty muted">
          Select a repository to inspect its worktree and local branches.
        </div>
      ) : (
        <>
          <div className="inspector-tabs inspector-tabs-3" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={section === "branches"}
              className={`inspector-tab${section === "branches" ? " active" : ""}`}
              onClick={() => setSection("branches")}
            >
              Branches
              {pullsSummary.behind > 0 ? (
                <span className="inspector-tab-badge">↓{pullsSummary.behind}</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "merge"}
              className={`inspector-tab${section === "merge" ? " active" : ""}`}
              onClick={() => setSection("merge")}
            >
              Merge
              {isMerging ? (
                <span className="inspector-tab-badge">!</span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === "worktree"}
              className={`inspector-tab${section === "worktree" ? " active" : ""}`}
              onClick={() => setSection("worktree")}
            >
              Worktree
              {files.length > 0 ? (
                <span className="inspector-tab-badge dirty">{files.length}</span>
              ) : null}
            </button>
          </div>

          {section === "branches" ? (
            <div className="inspector-body" role="tabpanel">
              <div className="inspector-toolbar">
                <input
                  type="search"
                  className="inspector-search"
                  placeholder="Filter local branches…"
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  title="Fetch remotes to refresh ahead/behind"
                  onClick={onFetch}
                >
                  Fetch
                </button>
              </div>
              <div className="inspector-summary muted">
                {localBranches.length} local
                {remoteCount > 0 ? ` · ${remoteCount} remote` : ""}
                {pullsSummary.behind > 0
                  ? ` · ${pullsSummary.behind} can pull`
                  : ""}
                {pullsSummary.ahead > 0
                  ? ` · ${pullsSummary.ahead} can push`
                  : ""}
              </div>
              <ul className="inspector-branch-list">
                {localBranches.length === 0 ? (
                  <li className="muted inspector-empty-row">No local branches</li>
                ) : (
                  localBranches.map((b) => {
                    const current = !!b.isCurrent;
                    const canPull = (b.behind ?? 0) > 0;
                    return (
                      <li
                        key={b.name}
                        className={`inspector-branch-row${current ? " current" : ""}${
                          canPull ? " needs-pull" : ""
                        }`}
                        onContextMenu={(e) => openCtx(e, branchMenuItems(b))}
                      >
                        <div className="inspector-branch-main">
                          <span className="mono inspector-branch-name" title={b.name}>
                            {current ? "★ " : ""}
                            {b.name}
                          </span>
                          <SyncBadge branch={b} />
                        </div>
                        {b.upstream ? (
                          <div className="muted mono inspector-upstream" title={b.upstream}>
                            → {b.upstream}
                          </div>
                        ) : (
                          <div className="muted inspector-upstream">No upstream</div>
                        )}
                        <div className="inspector-branch-actions">
                          {!current ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={locked}
                                onClick={() => onCheckout(b.name)}
                              >
                                Checkout
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={locked || isMerging || !!status?.isDirty}
                                title={
                                  status?.isDirty
                                    ? "Commit or stash before merging"
                                    : `Merge ${b.name} into ${currentBranch ?? "current"}`
                                }
                                onClick={() => runMerge(b.name)}
                              >
                                Merge
                              </button>
                            </>
                          ) : (
                            <span className="badge ok">current</span>
                          )}
                          {canPull ? (
                            <span
                              className="badge warn"
                              title="Behind upstream — checkout then pull"
                            >
                              pull available
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
              <div className="inspector-footer-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={onOpenBranches}
                >
                  Manage branches…
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setSection("merge")}
                >
                  Open merge…
                </button>
              </div>
            </div>
          ) : section === "merge" ? (
            <div className="inspector-body" role="tabpanel">
              {isMerging ? (
                <div className="inspector-merge-active">
                  <div className="merge-panel conflict" style={{ margin: 0 }}>
                    <strong>Merge in progress</strong>
                    <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                      {conflictCount > 0
                        ? `${conflictCount} conflicted file(s). Resolve, then commit — or abort.`
                        : "Finish with a commit, or abort the merge."}
                    </p>
                    {conflictCount > 0 && status?.conflictFiles ? (
                      <ul className="inspector-conflict-list mono">
                        {status.conflictFiles.slice(0, 8).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                        {conflictCount > 8 ? (
                          <li className="muted">+{conflictCount - 8} more…</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                  <div className="inspector-merge-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={mergeBusy}
                      onClick={() => onOpenMergeModal()}
                    >
                      Resolve conflicts…
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={mergeBusy}
                      onClick={onOpenStage}
                    >
                      Stage / commit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={mergeBusy}
                      onClick={onAbortMerge}
                    >
                      Abort merge
                    </button>
                  </div>
                </div>
              ) : (
                <div className="inspector-merge-form">
                  <p className="muted inspector-merge-intro">
                    Merge another branch into{" "}
                    <strong className="mono">
                      {currentBranch ?? "current branch"}
                    </strong>
                    . Working tree must be clean.
                  </p>

                  {status?.isDetached ? (
                    <div className="merge-panel conflict" style={{ margin: 0 }}>
                      Detached HEAD — checkout a branch before merging.
                    </div>
                  ) : status?.isDirty ? (
                    <div className="merge-panel conflict" style={{ margin: 0 }}>
                      Working tree is dirty. Commit, stash, or discard changes first.
                      <div className="inspector-merge-actions" style={{ marginTop: "0.5rem" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={onOpenStage}
                        >
                          Open stage
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <label className="inspector-field">
                        <span className="muted">Branch to merge in</span>
                        <select
                          value={mergeSource}
                          disabled={mergeBusy || locked}
                          onChange={(e) => setMergeSource(e.target.value)}
                        >
                          <option value="">— select branch —</option>
                          <optgroup label="Local">
                            {mergeCandidates
                              .filter((b) => b.kind === "local")
                              .map((b) => (
                                <option key={b.name} value={b.name}>
                                  {b.name}
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Remote">
                            {mergeCandidates
                              .filter((b) => b.kind === "remote")
                              .map((b) => (
                                <option key={b.name} value={b.name}>
                                  {b.name}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </label>

                      <label className="option-check inspector-option">
                        <input
                          type="checkbox"
                          checked={mergeNoFf}
                          disabled={mergeBusy || mergeSquash}
                          onChange={(e) => setMergeNoFf(e.target.checked)}
                        />
                        <span>
                          No fast-forward
                          <span className="muted"> — always merge commit</span>
                        </span>
                      </label>
                      <label className="option-check inspector-option">
                        <input
                          type="checkbox"
                          checked={mergeSquash}
                          disabled={mergeBusy}
                          onChange={(e) => {
                            setMergeSquash(e.target.checked);
                            if (e.target.checked) setMergeNoFf(false);
                          }}
                        />
                        <span>
                          Squash
                          <span className="muted"> — stage only, then commit</span>
                        </span>
                      </label>

                      <div className="inspector-merge-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={
                            mergeBusy ||
                            !mergeSource ||
                            !!status?.isDetached ||
                            !!status?.isDirty
                          }
                          onClick={() => runMerge(mergeSource)}
                        >
                          {mergeBusy ? "Merging…" : "Merge into current"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          disabled={mergeBusy}
                          onClick={() => onOpenMergeModal(mergeSource || undefined)}
                        >
                          Full merge dialog…
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="inspector-body" role="tabpanel">
              <div className="inspector-toolbar">
                <span className="muted">
                  {filesLoading
                    ? "Loading…"
                    : files.length === 0
                      ? "Clean worktree"
                      : `${files.length} file(s)`}
                </span>
                <div className="actions" style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy || filesLoading}
                    onClick={onRefreshFiles}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busy || files.length === 0}
                    onClick={onOpenStage}
                  >
                    Stage
                  </button>
                </div>
              </div>
              {files.length > 0 ? (
                <div className="inspector-summary muted">
                  {staged > 0 ? `${staged} staged` : "0 staged"}
                  {" · "}
                  {unstaged > 0 ? `${unstaged} unstaged` : "0 unstaged"}
                </div>
              ) : null}
              <ul className="inspector-file-list">
                {filesLoading ? (
                  <li className="muted inspector-empty-row">Loading…</li>
                ) : files.length === 0 ? (
                  <li className="muted inspector-empty-row">No changes</li>
                ) : (
                  files.map((f) => (
                    <li
                      key={f.path}
                      className="inspector-file-row"
                      onContextMenu={(e) => openCtx(e, fileMenuItems(f))}
                    >
                      <span
                        className={`file-status-code mono ${
                          f.staged && !f.unstaged ? "staged" : "dirty"
                        }`}
                      >
                        {f.status}
                      </span>
                      <span className="mono file-path" title={f.path}>
                        {f.path}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
