import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addRepo,
  checkoutBranch,
  checkoutCommit,
  commitRepo,
  createBranch,
  deleteBranch,
  fetchAllRepos,
  fetchRepo,
  getCommitLog,
  getFileDiff,
  getProject,
  getProjectRepoStatuses,
  listBranches,
  listChangedFiles,
  listProjectBranches,
  openRepoFolder,
  pickFolder,
  pullAll,
  pullRepo,
  pushAll,
  pushRepo,
  removeRepo,
  scanRepos,
  setRepoEnabled,
  discardFiles,
  stageFiles,
  unstageFiles,
} from "../lib/api";
import type {
  ChangedFile,
  CommitLogEntry,
  ProjectDetail as ProjectDetailType,
  PullResult,
  RepoStatus,
} from "../lib/types";
import { Toast } from "../components/Toast";
import { DiffView } from "../components/DiffView";

type BatchKind = "pull" | "fetch" | "push";

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const [detail, setDetail] = useState<ProjectDetailType | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [branches, setBranches] = useState<Record<string, string[]>>({});
  const [branchesReady, setBranchesReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [batchBusy, setBatchBusy] = useState<BatchKind | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<{
    kind: BatchKind;
    items: PullResult[];
  } | null>(null);

  // Commit modal
  const [commitRepoId, setCommitRepoId] = useState<string | null>(null);
  const [commitName, setCommitName] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);

  // History modal
  const [historyRepoId, setHistoryRepoId] = useState<string | null>(null);
  const [historyName, setHistoryName] = useState("");
  const [historyEntries, setHistoryEntries] = useState<CommitLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [branchFromHash, setBranchFromHash] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);

  // Branch modal
  const [branchRepoId, setBranchRepoId] = useState<string | null>(null);
  const [branchRepoName, setBranchRepoName] = useState("");
  const [branchList, setBranchList] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [checkoutNew, setCheckoutNew] = useState(true);
  const [branchBusy, setBranchBusy] = useState(false);

  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setBranchesReady(false);
    try {
      const d = await getProject(projectId);
      setDetail(d);

      const [st, branchMap] = await Promise.all([
        getProjectRepoStatuses(projectId),
        listProjectBranches(projectId),
      ]);

      const map: Record<string, RepoStatus> = {};
      for (const s of st) map[s.repoId] = s;
      setStatuses(map);
      setBranches(branchMap);
      setBranchesReady(true);
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCheckout(repoId: string, branch: string) {
    if (!branch) return;
    try {
      const st = await checkoutBranch(repoId, branch, false);
      setStatuses((prev) => ({ ...prev, [repoId]: st }));
      setToast({ msg: `Switched to ${branch}` });
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onToggle(repoId: string, enabled: boolean) {
    try {
      await setRepoEnabled(repoId, enabled);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onRemove(repoId: string, name: string) {
    if (!confirm(`Remove “${name}” from this project?`)) return;
    try {
      await removeRepo(repoId);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onAddRepo() {
    const folder = await pickFolder("Select a git repository");
    if (!folder) return;
    try {
      await addRepo(projectId, folder);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onRescan() {
    if (!detail?.project.rootPath) {
      setToast({ msg: "Project has no root path to scan", error: true });
      return;
    }
    try {
      const found = await scanRepos(detail.project.rootPath, 5);
      const existing = new Set(detail.repos.map((r) => r.path));
      let added = 0;
      for (const r of found) {
        if (!existing.has(r.path)) {
          await addRepo(projectId, r.path);
          added += 1;
        }
      }
      await refresh();
      setToast({ msg: added ? `Added ${added} repo(s)` : "No new repos found" });
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function runBatch(
    kind: BatchKind,
    confirmText: string,
    fn: (id: string) => Promise<PullResult[]>,
  ) {
    const enabled = detail?.repos.filter((r) => r.enabled) ?? [];
    if (enabled.length === 0) {
      setToast({ msg: "No enabled repositories", error: true });
      return;
    }
    if (!confirm(confirmText.replace("{n}", String(enabled.length)))) {
      return;
    }
    setBatchBusy(kind);
    setBatchResults(null);
    try {
      const res = await fn(projectId);
      setBatchResults({ kind, items: res });
      const ok = res.filter((r) => r.success).length;
      const fail = res.length - ok;
      setToast({
        msg: `${kind} done: ${ok} ok, ${fail} failed`,
        error: fail > 0,
      });
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setBatchBusy(null);
    }
  }

  async function runRepoOp(
    repoId: string,
    label: string,
    fn: (id: string) => Promise<PullResult>,
  ) {
    setRowBusy(repoId);
    try {
      const res = await fn(repoId);
      setToast({
        msg: `${label} ${res.repoName}: ${res.message}`,
        error: !res.success,
      });
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setRowBusy(null);
    }
  }

  async function refreshChangedFiles(repoId: string) {
    const files = await listChangedFiles(repoId);
    setChangedFiles(files);
    // Keep selection only for paths that still exist
    setSelectedPaths((prev) => {
      const keep = new Set<string>();
      for (const f of files) {
        if (prev.has(f.path)) keep.add(f.path);
      }
      // If nothing selected (first open), select unstaged / all
      if (keep.size === 0) {
        for (const f of files) keep.add(f.path);
      }
      return keep;
    });
    return files;
  }

  async function openCommit(repoId: string, name: string) {
    setCommitRepoId(repoId);
    setCommitName(name);
    setCommitMsg("");
    setChangedFiles([]);
    setSelectedPaths(new Set());
    setDiffPath(null);
    setDiffText("");
    try {
      const files = await listChangedFiles(repoId);
      setChangedFiles(files);
      setSelectedPaths(new Set(files.map((f) => f.path)));
      // Auto-open first file’s diff so the right panel isn’t empty
      if (files[0]) {
        setDiffPath(files[0].path);
        setDiffLoading(true);
        try {
          setDiffText(await getFileDiff(repoId, files[0].path));
        } catch (e) {
          setDiffText(String(e));
        } finally {
          setDiffLoading(false);
        }
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function showDiff(path: string) {
    if (!commitRepoId) return;
    setDiffPath(path);
    setDiffLoading(true);
    try {
      const d = await getFileDiff(commitRepoId, path);
      setDiffText(d);
    } catch (e) {
      setDiffText(String(e));
    } finally {
      setDiffLoading(false);
    }
  }

  function togglePath(path: string) {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectAllFiles(on: boolean) {
    if (on) setSelectedPaths(new Set(changedFiles.map((f) => f.path)));
    else setSelectedPaths(new Set());
  }

  async function applyStagePaths(paths: string[], label: string) {
    if (!commitRepoId) return;
    if (paths.length === 0) {
      setToast({ msg: `Select files to ${label.toLowerCase()}`, error: true });
      return;
    }
    setCommitBusy(true);
    try {
      const files = await stageFiles(commitRepoId, paths);
      setChangedFiles(files);
      setSelectedPaths((prev) => {
        const next = new Set<string>();
        for (const f of files) {
          if (prev.has(f.path) || paths.includes(f.path)) next.add(f.path);
        }
        if (next.size === 0) {
          for (const f of files) next.add(f.path);
        }
        return next;
      });
      setToast({ msg: `${label} ${paths.length} file(s)` });
      // Refresh diff for current file if still open
      if (diffPath) {
        try {
          setDiffText(await getFileDiff(commitRepoId, diffPath));
        } catch {
          /* ignore */
        }
      }
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function applyUnstagePaths(paths: string[], label: string) {
    if (!commitRepoId) return;
    if (paths.length === 0) {
      setToast({ msg: `Select files to ${label.toLowerCase()}`, error: true });
      return;
    }
    setCommitBusy(true);
    try {
      const files = await unstageFiles(commitRepoId, paths);
      setChangedFiles(files);
      setToast({ msg: `${label} ${paths.length} file(s)` });
      if (diffPath) {
        try {
          setDiffText(await getFileDiff(commitRepoId, diffPath));
        } catch {
          /* ignore */
        }
      }
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function onStageSelected() {
    await applyStagePaths(Array.from(selectedPaths), "Staged");
  }

  async function onUnstageSelected() {
    await applyUnstagePaths(Array.from(selectedPaths), "Unstaged");
  }

  async function onStageAll() {
    if (!commitRepoId) return;
    setCommitBusy(true);
    try {
      const files = await stageFiles(commitRepoId, []);
      setChangedFiles(files);
      setSelectedPaths(new Set(files.map((f) => f.path)));
      setToast({ msg: "Staged all changes" });
      if (diffPath) {
        try {
          setDiffText(await getFileDiff(commitRepoId, diffPath));
        } catch {
          /* ignore */
        }
      }
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function onUnstageAll() {
    if (!commitRepoId) return;
    setCommitBusy(true);
    try {
      const files = await unstageFiles(commitRepoId, []);
      setChangedFiles(files);
      setToast({ msg: "Unstaged all" });
      if (diffPath) {
        try {
          setDiffText(await getFileDiff(commitRepoId, diffPath));
        } catch {
          /* ignore */
        }
      }
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function discardPaths(paths: string[]) {
    if (!commitRepoId) return;
    if (paths.length === 0) {
      setToast({ msg: "Select files to discard", error: true });
      return;
    }
    const n = paths.length;
    const preview = paths.slice(0, 8).join("\n  ");
    const more = n > 8 ? `\n  … and ${n - 8} more` : "";
    if (
      !confirm(
        `Discard local changes for ${n} file(s)?\n\n  ${preview}${more}\n\n` +
          `• Tracked files are restored to HEAD (staged + unstaged)\n` +
          `• Untracked files are deleted\n\n` +
          `This cannot be undone.`,
      )
    ) {
      return;
    }
    setCommitBusy(true);
    try {
      const files = await discardFiles(commitRepoId, paths);
      setChangedFiles(files);
      setSelectedPaths(new Set(files.map((f) => f.path)));
      if (diffPath && paths.includes(diffPath)) {
        setDiffPath(null);
        setDiffText("");
      }
      setToast({ msg: `Discarded ${n} file(s)` });
      if (files.length === 0) {
        setCommitRepoId(null);
      }
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function onDiscardSelected() {
    await discardPaths(Array.from(selectedPaths));
  }

  /** Stage selected files (if any unstaged among selection), then commit. */
  async function submitCommit(stageSelectedFirst: boolean) {
    if (!commitRepoId || !commitMsg.trim()) {
      setToast({ msg: "Commit message required", error: true });
      return;
    }
    setCommitBusy(true);
    try {
      if (stageSelectedFirst) {
        if (selectedPaths.size === 0) {
          setToast({ msg: "Select files to stage & commit", error: true });
          setCommitBusy(false);
          return;
        }
        await stageFiles(commitRepoId, Array.from(selectedPaths));
      }
      // Commit whatever is currently staged
      const res = await commitRepo(commitRepoId, commitMsg.trim(), {
        stageAll: false,
        paths: undefined,
      });
      setToast({
        msg: res.success
          ? `Committed in ${commitName}: ${res.message}`
          : res.message,
        error: !res.success,
      });
      if (res.success) {
        setCommitRepoId(null);
        await refresh();
      } else {
        await refreshChangedFiles(commitRepoId);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setCommitBusy(false);
    }
  }

  async function openHistory(repoId: string, name: string) {
    setHistoryRepoId(repoId);
    setHistoryName(name);
    setHistoryEntries([]);
    setBranchFromHash("");
    setHistoryLoading(true);
    try {
      const log = await getCommitLog(repoId, 50);
      setHistoryEntries(log);
    } catch (e) {
      setToast({ msg: String(e), error: true });
      setHistoryRepoId(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function onCheckoutDetached(hash: string) {
    if (!historyRepoId) return;
    if (
      !confirm(
        `Checkout ${hash.slice(0, 7)} as detached HEAD?\nWorking tree must be clean.`,
      )
    ) {
      return;
    }
    setHistoryBusy(true);
    try {
      const st = await checkoutCommit(historyRepoId, hash, null);
      setStatuses((prev) => ({ ...prev, [historyRepoId]: st }));
      setToast({ msg: `Detached at ${hash.slice(0, 7)}` });
      setHistoryRepoId(null);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setHistoryBusy(false);
    }
  }

  async function onBranchAtCommit(hash: string) {
    if (!historyRepoId) return;
    const name = branchFromHash.trim();
    if (!name) {
      setToast({ msg: "Enter a new branch name", error: true });
      return;
    }
    setHistoryBusy(true);
    try {
      const st = await checkoutCommit(historyRepoId, hash, name);
      setStatuses((prev) => ({ ...prev, [historyRepoId]: st }));
      setToast({ msg: `Branch ${name} at ${hash.slice(0, 7)}` });
      setHistoryRepoId(null);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setHistoryBusy(false);
    }
  }

  async function openBranches(repoId: string, name: string) {
    setBranchRepoId(repoId);
    setBranchRepoName(name);
    setNewBranchName("");
    setCheckoutNew(true);
    try {
      const list = await listBranches(repoId);
      setBranchList(list);
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onCreateBranch() {
    if (!branchRepoId || !newBranchName.trim()) return;
    setBranchBusy(true);
    try {
      const st = await createBranch(
        branchRepoId,
        newBranchName.trim(),
        checkoutNew,
      );
      setStatuses((prev) => ({ ...prev, [branchRepoId]: st }));
      setToast({
        msg: checkoutNew
          ? `Created and checked out ${newBranchName.trim()}`
          : `Created ${newBranchName.trim()}`,
      });
      setBranchRepoId(null);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setBranchBusy(false);
    }
  }

  async function onDeleteBranchSafe(name: string) {
    if (!branchRepoId) return;
    if (!confirm(`Delete local branch “${name}”? (git branch -d)`)) return;
    setBranchBusy(true);
    try {
      await deleteBranch(branchRepoId, name, false);
      setToast({ msg: `Deleted ${name}` });
      const list = await listBranches(branchRepoId);
      setBranchList(list);
      await refresh();
    } catch (e) {
      const msg = String(e);
      if (
        msg.toLowerCase().includes("not fully merged") &&
        confirm(`${msg}\n\nForce delete with -D?`)
      ) {
        try {
          await deleteBranch(branchRepoId, name, true);
          setToast({ msg: `Force-deleted ${name}` });
          const list = await listBranches(branchRepoId);
          setBranchList(list);
          await refresh();
        } catch (e2) {
          setToast({ msg: String(e2), error: true });
        }
      } else {
        setToast({ msg, error: true });
      }
    } finally {
      setBranchBusy(false);
    }
  }

  async function onOpenFolder(repoId: string) {
    try {
      await openRepoFolder(repoId);
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  if (loading && !detail) {
    return <div className="empty">Loading…</div>;
  }
  if (!detail) {
    return <div className="empty">Project not found</div>;
  }

  const busy = batchBusy !== null || rowBusy !== null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{detail.project.name}</h1>
          <p className="mono">{detail.project.rootPath ?? "No root path"}</p>
        </div>
        <div className="actions">
          <Link className="btn" to={`/projects/${projectId}/environments`}>
            Environments
          </Link>
          <Link className="btn btn-primary" to={`/projects/${projectId}/switch`}>
            Switch environment
          </Link>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void runBatch(
                "fetch",
                "Fetch for {n} enabled repo(s)?",
                fetchAllRepos,
              )
            }
          >
            {batchBusy === "fetch" ? "Fetching…" : "Fetch all"}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void runBatch(
                "pull",
                "Pull (ff-only) for {n} enabled repo(s)?",
                pullAll,
              )
            }
          >
            {batchBusy === "pull" ? "Pulling…" : "Pull all"}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void runBatch("push", "Push for {n} enabled repo(s)?", pushAll)
            }
          >
            {batchBusy === "push" ? "Pushing…" : "Push all"}
          </button>
          <button className="btn" onClick={() => void onRescan()} disabled={busy}>
            Rescan
          </button>
          <button className="btn" onClick={() => void onAddRepo()} disabled={busy}>
            Add repo
          </button>
          <button className="btn" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      {batchResults && batchResults.items.length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <strong>
            {batchResults.kind === "pull"
              ? "Pull"
              : batchResults.kind === "push"
                ? "Push"
                : "Fetch"}{" "}
            results
          </strong>
          <ul className="result-list">
            {batchResults.items.map((r) => (
              <li key={r.repoId}>
                <span className={`badge ${r.success ? "ok" : "err"}`}>
                  {r.repoName}
                </span>{" "}
                <span className="muted mono" title={r.message}>
                  {r.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.repos.length === 0 ? (
        <div className="card empty">
          <p>No repositories in this project.</p>
          <button className="btn btn-primary" onClick={() => void onAddRepo()}>
            Add a repo
          </button>
        </div>
      ) : (
        <div className="repo-list">
          <div className="repo-list-meta muted">
            {detail.repos.length} repo{detail.repos.length === 1 ? "" : "s"} ·
            scroll vertically — no horizontal pan needed
          </div>
          {detail.repos.map((repo) => {
            const st = statuses[repo.id];
            const repoBranches = branches[repo.id] ?? [];
            const thisBusy = rowBusy === repo.id;
            return (
              <article
                key={repo.id}
                className={`repo-card${repo.enabled ? "" : " disabled"}`}
              >
                <div className="repo-card-main">
                  <label className="repo-enable" title="Include in batch ops">
                    <input
                      type="checkbox"
                      checked={repo.enabled}
                      onChange={(e) =>
                        void onToggle(repo.id, e.target.checked)
                      }
                    />
                  </label>

                  <div className="repo-card-identity">
                    <div className="repo-card-title-row">
                      <h3 className="repo-card-name">{repo.name}</h3>
                      {st?.error ? (
                        <span className="badge err">{st.error}</span>
                      ) : st?.isDirty ? (
                        <span className="badge warn">
                          <span className="status-dot dirty" /> dirty
                        </span>
                      ) : (
                        <span className="badge ok">
                          <span className="status-dot clean" /> clean
                        </span>
                      )}
                      {st?.ahead != null || st?.behind != null ? (
                        <span
                          className={
                            (st.ahead ?? 0) > 0 || (st.behind ?? 0) > 0
                              ? "sync-drift mono"
                              : "muted mono"
                          }
                          title="Ahead / behind upstream"
                        >
                          ↑{st.ahead ?? 0} ↓{st.behind ?? 0}
                        </span>
                      ) : null}
                    </div>
                    <div className="muted mono repo-card-path" title={repo.path}>
                      {repo.path}
                    </div>
                    {st?.lastCommit ? (
                      <div className="repo-card-commit muted" title={st.lastCommit}>
                        <span className="commit-subject">{st.lastCommit}</span>
                        {st.lastCommitAt ? (
                          <span> · {st.lastCommitAt}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="repo-card-branch">
                    <label className="repo-branch-label muted">Branch</label>
                    <select
                      className="repo-branch-select"
                      value={st?.currentBranch ?? ""}
                      disabled={
                        busy ||
                        (!branchesReady && repoBranches.length === 0) ||
                        !!st?.error
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v && v !== st?.currentBranch) {
                          void onCheckout(repo.id, v);
                        }
                      }}
                      title={
                        st?.isDetached
                          ? "Detached HEAD"
                          : (st?.currentBranch ?? "Select branch")
                      }
                    >
                      {!st?.currentBranch && (
                        <option value="">
                          {st?.isDetached ? "detached…" : "Select…"}
                        </option>
                      )}
                      {st?.currentBranch &&
                        !repoBranches.includes(st.currentBranch) && (
                          <option value={st.currentBranch}>
                            {st.currentBranch}
                            {st.isDetached ? " (detached)" : ""}
                          </option>
                        )}
                      {repoBranches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="repo-card-actions">
                  <div className="repo-actions-primary">
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void runRepoOp(repo.id, "Fetch", fetchRepo)
                      }
                    >
                      {thisBusy ? "…" : "Fetch"}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void runRepoOp(repo.id, "Pull", pullRepo)}
                    >
                      Pull
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void runRepoOp(repo.id, "Push", pushRepo)}
                    >
                      Push
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy || !st?.isDirty}
                      title="Stage / unstage / commit"
                      onClick={() => void openCommit(repo.id, repo.name)}
                    >
                      Stage
                    </button>
                  </div>
                  <div className="repo-actions-secondary">
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => void openHistory(repo.id, repo.name)}
                    >
                      History
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => void openBranches(repo.id, repo.name)}
                    >
                      Branches
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => void onOpenFolder(repo.id)}
                    >
                      Folder
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => void onRemove(repo.id, repo.name)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Stage / Commit modal */}
      {commitRepoId && (
        <div className="modal-backdrop" onClick={() => setCommitRepoId(null)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Stage & commit — {commitName}</h2>
            <div className="form-grid">
              <div className="file-list-header">
                <strong>Changed files</strong>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => selectAllFiles(true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => selectAllFiles(false)}
                  >
                    Select none
                  </button>
                </div>
              </div>

              <div className="actions stage-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={commitBusy || selectedPaths.size === 0}
                  onClick={() => void onStageSelected()}
                >
                  Stage selected
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={commitBusy || selectedPaths.size === 0}
                  onClick={() => void onUnstageSelected()}
                >
                  Unstage selected
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={commitBusy || changedFiles.length === 0}
                  onClick={() => void onStageAll()}
                >
                  Stage all
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={commitBusy}
                  onClick={() => void onUnstageAll()}
                >
                  Unstage all
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={commitBusy || selectedPaths.size === 0}
                  title="Restore selected files to HEAD / delete untracked"
                  onClick={() => void onDiscardSelected()}
                >
                  Discard selected
                </button>
              </div>

              {changedFiles.length === 0 ? (
                <p className="muted">No changes (working tree clean)</p>
              ) : (
                <div className="commit-layout">
                  <div className="file-list">
                    {changedFiles.map((f) => {
                      const active = diffPath === f.path;
                      return (
                        <div
                          key={f.path}
                          className={`file-row-wrap${active ? " active" : ""}`}
                        >
                          <label className="file-row">
                            <input
                              type="checkbox"
                              checked={selectedPaths.has(f.path)}
                              onChange={() => togglePath(f.path)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span
                              className={`file-status mono status-${f.status === "?" ? "untracked" : f.status.toLowerCase()}`}
                              title={
                                f.status === "?"
                                  ? "New / untracked"
                                  : f.status === "M"
                                    ? "Modified"
                                    : f.status === "A"
                                      ? "Added"
                                      : f.status === "D"
                                        ? "Deleted"
                                        : f.status
                              }
                            >
                              {f.status === "?"
                                ? "NEW"
                                : f.status === "M"
                                  ? "MOD"
                                  : f.status === "A"
                                    ? "ADD"
                                    : f.status === "D"
                                      ? "DEL"
                                      : f.status}
                            </span>
                            <button
                              type="button"
                              className="file-path-btn mono"
                              title={`${f.path} — click to view changes`}
                              onClick={() => void showDiff(f.path)}
                            >
                              {f.path}
                            </button>
                          </label>
                          <div className="file-row-btns">
                            {f.unstaged && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={commitBusy}
                                title="Stage this file"
                                onClick={() =>
                                  void applyStagePaths([f.path], "Staged")
                                }
                              >
                                Stage
                              </button>
                            )}
                            {f.staged && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={commitBusy}
                                title="Unstage this file"
                                onClick={() =>
                                  void applyUnstagePaths([f.path], "Unstaged")
                                }
                              >
                                Unstage
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              disabled={commitBusy}
                              title="Discard changes to this file"
                              onClick={() => void discardPaths([f.path])}
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="diff-panel">
                    <DiffView
                      filePath={diffPath}
                      diffText={diffText}
                      loading={diffLoading}
                    />
                  </div>
                </div>
              )}
              <label>
                Message
                <input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Describe the change"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitCommit(true);
                  }}
                />
              </label>
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Stage files first (or use “Stage & commit”). “Commit staged”
                only commits what is already in the index.
              </p>
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button
                  className="btn"
                  disabled={commitBusy}
                  onClick={() => setCommitRepoId(null)}
                >
                  Close
                </button>
                <button
                  className="btn"
                  disabled={commitBusy || !commitMsg.trim()}
                  title="Commit only what is already staged"
                  onClick={() => void submitCommit(false)}
                >
                  Commit staged
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    commitBusy ||
                    !commitMsg.trim() ||
                    selectedPaths.size === 0
                  }
                  title="Stage selected files, then commit"
                  onClick={() => void submitCommit(true)}
                >
                  {commitBusy ? "Working…" : "Stage & commit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History modal */}
      {historyRepoId && (
        <div className="modal-backdrop" onClick={() => setHistoryRepoId(null)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>History — {historyName}</h2>
            <div className="card" style={{ marginBottom: "0.75rem" }}>
              <label>
                New branch name (for “Branch here”)
                <input
                  type="text"
                  value={branchFromHash}
                  onChange={(e) => setBranchFromHash(e.target.value)}
                  placeholder="e.g. fix/from-old-commit"
                />
              </label>
            </div>
            {historyLoading ? (
              <p className="muted">Loading…</p>
            ) : historyEntries.length === 0 ? (
              <p className="muted">No commits</p>
            ) : (
              <div className="history-list">
                {historyEntries.map((e) => (
                  <div key={e.hash} className="history-row">
                    <span className="mono history-hash" title={e.hash}>
                      {e.shortHash}
                    </span>
                    <div className="history-body">
                      <div className="history-subject">{e.subject}</div>
                      <div className="muted">
                        {e.author} · {e.when}
                      </div>
                      <div className="row-actions" style={{ marginTop: 4 }}>
                        <button
                          className="btn btn-sm"
                          disabled={historyBusy}
                          onClick={() => void onCheckoutDetached(e.hash)}
                        >
                          Detach
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={historyBusy || !branchFromHash.trim()}
                          onClick={() => void onBranchAtCommit(e.hash)}
                        >
                          Branch here
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button
                className="btn"
                disabled={historyBusy}
                onClick={() => setHistoryRepoId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Branches modal */}
      {branchRepoId && (
        <div className="modal-backdrop" onClick={() => setBranchRepoId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Branches — {branchRepoName}</h2>
            <div className="form-grid">
              <label>
                New branch
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/my-work"
                />
              </label>
              <label className="option-check">
                <input
                  type="checkbox"
                  checked={checkoutNew}
                  onChange={(e) => setCheckoutNew(e.target.checked)}
                />
                <span>Checkout after create</span>
              </label>
              <div className="actions">
                <button
                  className="btn btn-primary"
                  disabled={branchBusy || !newBranchName.trim()}
                  onClick={() => void onCreateBranch()}
                >
                  {branchBusy ? "Working…" : "Create branch"}
                </button>
              </div>
              <div className="file-list" style={{ maxHeight: 280 }}>
                {branchList.map((b) => {
                  const current =
                    statuses[branchRepoId]?.currentBranch === b;
                  return (
                    <div key={b} className="file-row-wrap">
                      <span className="mono file-path">
                        {b}
                        {current ? " ★" : ""}
                      </span>
                      <div className="row-actions">
                        {!current && (
                          <>
                            <button
                              className="btn btn-sm"
                              disabled={branchBusy}
                              onClick={() => {
                                void onCheckout(branchRepoId, b);
                                setBranchRepoId(null);
                              }}
                            >
                              Checkout
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={branchBusy}
                              onClick={() => void onDeleteBranchSafe(b)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setBranchRepoId(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <Toast
          message={toast.msg}
          error={toast.error}
          onClose={() => setToast(null)}
        />
      )}
    </>
  );
}
