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
  mergeAbort,
  mergeBranch,
  openRepoFolder,
  pickFolder,
  pullAll,
  pullRepo,
  pushAll,
  pushRepo,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto,
  rebaseSkip,
  removeRepo,
  scanRepos,
  setRepoEnabled,
  discardFiles,
  stageFiles,
  unstageFiles,
} from "../lib/api";
import type {
  BranchInfo,
  ChangedFile,
  CommitLogEntry,
  MergeResult,
  ProjectDetail as ProjectDetailType,
  PullResult,
  RebaseResult,
  Repo,
  RepoStatus,
} from "../lib/types";
import { Toast } from "../components/Toast";
import { DiffView } from "../components/DiffView";
import { CommitGraph } from "../components/CommitGraph";
import { ConflictPanel } from "../components/ConflictPanel";
import { RepoInspector } from "../components/RepoInspector";
import {
  copyToClipboard,
  useContextMenu,
  type ContextMenuItem,
} from "../components/ContextMenu";
import { Icon } from "../components/Icon";

type BatchKind = "pull" | "fetch" | "push";
type RepoViewMode = "list" | "tabs";

const VIEW_MODE_KEY = "git-workspace.repoViewMode";
const INSPECTOR_COLLAPSED_KEY = "git-workspace.inspector-collapsed";
const TAB_HISTORY_LIMIT = 500;
const FULL_HISTORY_LIMIT = 1000;

function localPullCount(list: BranchInfo[] | undefined): number {
  if (!list) return 0;
  return list.filter((b) => b.kind === "local" && (b.behind ?? 0) > 0).length;
}

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const { open: openCtx, menuNode: ctxMenu } = useContextMenu();
  const [detail, setDetail] = useState<ProjectDetailType | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [branches, setBranches] = useState<Record<string, BranchInfo[]>>({});
  const [branchesReady, setBranchesReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [batchBusy, setBatchBusy] = useState<BatchKind | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<{
    kind: BatchKind;
    items: PullResult[];
  } | null>(null);

  // List vs tabbed repo detail
  const [viewMode, setViewMode] = useState<RepoViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY);
      return v === "tabs" ? "tabs" : "list";
    } catch {
      return "list";
    }
  });
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabCommits, setTabCommits] = useState<CommitLogEntry[]>([]);
  const [tabFiles, setTabFiles] = useState<ChangedFile[]>([]);
  const [tabDetailLoading, setTabDetailLoading] = useState(false);
  const [tabDetailError, setTabDetailError] = useState<string | null>(null);

  // Focused repo for right inspector (worktree + local branches)
  const [focusedRepoId, setFocusedRepoId] = useState<string | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => {
    try {
      return localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [inspectorFiles, setInspectorFiles] = useState<ChangedFile[]>([]);
  const [inspectorFilesLoading, setInspectorFilesLoading] = useState(false);

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
  const [branchList, setBranchList] = useState<BranchInfo[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [checkoutNew, setCheckoutNew] = useState(true);
  const [branchBusy, setBranchBusy] = useState(false);

  // Merge modal
  const [mergeRepoId, setMergeRepoId] = useState<string | null>(null);
  const [mergeRepoName, setMergeRepoName] = useState("");
  const [mergeBranches, setMergeBranches] = useState<BranchInfo[]>([]);
  const [mergeSource, setMergeSource] = useState("");
  const [mergeNoFf, setMergeNoFf] = useState(false);
  const [mergeSquash, setMergeSquash] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

  // Rebase modal
  const [rebaseRepoId, setRebaseRepoId] = useState<string | null>(null);
  const [rebaseRepoName, setRebaseRepoName] = useState("");
  const [rebaseBranches, setRebaseBranches] = useState<BranchInfo[]>([]);
  const [rebaseOntoBranch, setRebaseOntoBranch] = useState("");
  const [rebaseBusy, setRebaseBusy] = useState(false);
  const [rebaseResult, setRebaseResult] = useState<RebaseResult | null>(null);

  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  function changeViewMode(mode: RepoViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }

  function toggleInspector() {
    setInspectorCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const loadInspectorFiles = useCallback(async (repoId: string) => {
    setInspectorFilesLoading(true);
    try {
      const files = await listChangedFiles(repoId);
      setInspectorFiles(files);
    } catch {
      setInspectorFiles([]);
    } finally {
      setInspectorFilesLoading(false);
    }
  }, []);

  const loadTabDetail = useCallback(async (repoId: string) => {
    setTabDetailLoading(true);
    setTabDetailError(null);
    try {
      const [commits, files] = await Promise.all([
        getCommitLog(repoId, TAB_HISTORY_LIMIT),
        listChangedFiles(repoId),
      ]);
      setTabCommits(commits);
      setTabFiles(files);
    } catch (e) {
      setTabCommits([]);
      setTabFiles([]);
      setTabDetailError(String(e));
    } finally {
      setTabDetailLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setBranchesReady(false);
    try {
      const d = await getProject(projectId);
      setDetail(d);

      // Keep active tab valid when repos change
      setActiveTabId((prev) => {
        if (prev && d.repos.some((r) => r.id === prev)) return prev;
        return d.repos[0]?.id ?? null;
      });

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

  // Keep focused repo valid; prefer active tab in tabs mode.
  useEffect(() => {
    if (!detail) return;
    setFocusedRepoId((prev) => {
      if (viewMode === "tabs" && activeTabId) {
        if (detail.repos.some((r) => r.id === activeTabId)) return activeTabId;
      }
      if (prev && detail.repos.some((r) => r.id === prev)) return prev;
      return detail.repos[0]?.id ?? null;
    });
  }, [detail, viewMode, activeTabId]);

  // Load commits + working tree when tab selection / mode changes,
  // and again after project refresh finishes (loading → false).
  useEffect(() => {
    if (viewMode !== "tabs" || !activeTabId || loading) return;
    void loadTabDetail(activeTabId);
  }, [viewMode, activeTabId, loadTabDetail, loading]);

  // Inspector worktree for focused repo
  useEffect(() => {
    if (!focusedRepoId || loading) return;
    void loadInspectorFiles(focusedRepoId);
  }, [focusedRepoId, loading, loadInspectorFiles]);

  async function onCheckout(repoId: string, branch: string) {
    if (!branch) return;
    try {
      const st = await checkoutBranch(repoId, branch, false);
      setStatuses((prev) => ({ ...prev, [repoId]: st }));
      try {
        const list = await listBranches(repoId);
        setBranches((prev) => ({ ...prev, [repoId]: list }));
      } catch {
        /* keep previous branch list */
      }
      setToast({ msg: `Switched to ${branch}` });
      if (focusedRepoId === repoId) {
        void loadInspectorFiles(repoId);
      }
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
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
      const log = await getCommitLog(repoId, FULL_HISTORY_LIMIT);
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

  async function copyText(text: string, label: string) {
    const ok = await copyToClipboard(text);
    setToast({
      msg: ok ? `Copied ${label}` : "Could not copy to clipboard",
      error: !ok,
    });
  }

  function repoContextItems(repo: Repo): ContextMenuItem[] {
    const st = statuses[repo.id];
    const busyRow = batchBusy !== null || rowBusy === repo.id;
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: repo.name },
      {
        id: "inspect",
        label: "Inspect",
        onSelect: () => setFocusedRepoId(repo.id),
      },
      {
        id: "fetch",
        label: "Fetch",
        disabled: busyRow,
        onSelect: () => void runRepoOp(repo.id, "Fetch", fetchRepo),
      },
      {
        id: "pull",
        label: "Pull",
        disabled: busyRow,
        onSelect: () => void runRepoOp(repo.id, "Pull", pullRepo),
      },
      {
        id: "push",
        label: "Push",
        disabled: busyRow,
        onSelect: () => void runRepoOp(repo.id, "Push", pushRepo),
      },
      { type: "separator", id: "s1" },
      {
        id: "stage",
        label: "Stage & commit…",
        disabled: busyRow || !st?.isDirty,
        onSelect: () => void openCommit(repo.id, repo.name),
      },
      {
        id: "branches",
        label: "Branches…",
        disabled: busyRow,
        onSelect: () => void openBranches(repo.id, repo.name),
      },
      {
        id: "history",
        label: "History…",
        disabled: busyRow,
        onSelect: () => void openHistory(repo.id, repo.name),
      },
      {
        id: "merge",
        label: "Merge…",
        disabled: busyRow || !!st?.isDetached,
        onSelect: () => void openMerge(repo.id, repo.name),
      },
      {
        id: "rebase",
        label: "Rebase…",
        disabled: busyRow || !!st?.isDetached,
        onSelect: () => void openRebase(repo.id, repo.name),
      },
    ];
    if (st?.isMerging) {
      items.push({
        id: "abort-merge",
        label: "Abort merge…",
        danger: true,
        disabled: busyRow,
        onSelect: () => void onAbortMerge(repo.id),
      });
    }
    if (st?.isRebasing) {
      items.push({
        id: "abort-rebase",
        label: "Abort rebase…",
        danger: true,
        disabled: busyRow,
        onSelect: () => void onAbortRebase(repo.id),
      });
    }
    items.push({ type: "separator", id: "s2" });
    items.push({
      id: "folder",
      label: "Open folder",
      disabled: busyRow,
      onSelect: () => void onOpenFolder(repo.id),
    });
    items.push({
      id: "copy-path",
      label: "Copy path",
      onSelect: () => void copyText(repo.path, "path"),
    });
    if (st?.currentBranch) {
      items.push({
        id: "copy-branch",
        label: "Copy current branch",
        onSelect: () => void copyText(st.currentBranch!, "branch"),
      });
    }
    items.push({ type: "separator", id: "s3" });
    items.push({
      id: "toggle",
      label: repo.enabled ? "Disable for batch ops" : "Enable for batch ops",
      onSelect: () => void onToggle(repo.id, !repo.enabled),
    });
    items.push({
      id: "remove",
      label: "Remove from project…",
      danger: true,
      disabled: busyRow,
      onSelect: () => void onRemove(repo.id, repo.name),
    });
    return items;
  }

  function changedFileContextItems(
    f: ChangedFile,
    opts: { showDiff?: boolean } = {},
  ): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: f.path },
    ];
    if (opts.showDiff) {
      items.push({
        id: "diff",
        label: "View diff",
        onSelect: () => void showDiff(f.path),
      });
    }
    if (f.unstaged) {
      items.push({
        id: "stage",
        label: "Stage",
        disabled: commitBusy,
        onSelect: () => void applyStagePaths([f.path], "Staged"),
      });
    }
    if (f.staged) {
      items.push({
        id: "unstage",
        label: "Unstage",
        disabled: commitBusy,
        onSelect: () => void applyUnstagePaths([f.path], "Unstaged"),
      });
    }
    items.push({
      id: "discard",
      label: "Discard changes…",
      danger: true,
      disabled: commitBusy,
      onSelect: () => void discardPaths([f.path]),
    });
    items.push({ type: "separator", id: "s1" });
    items.push({
      id: "copy",
      label: "Copy path",
      onSelect: () => void copyText(f.path, "path"),
    });
    return items;
  }

  function commitContextItems(
    c: CommitLogEntry,
    repoId: string | null,
  ): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: c.shortHash },
      {
        id: "copy-short",
        label: "Copy short hash",
        onSelect: () => void copyText(c.shortHash, "hash"),
      },
      {
        id: "copy-full",
        label: "Copy full hash",
        onSelect: () => void copyText(c.hash, "hash"),
      },
      {
        id: "copy-msg",
        label: "Copy subject",
        onSelect: () => void copyText(c.subject, "subject"),
      },
    ];
    if (repoId) {
      items.push({ type: "separator", id: "s1" });
      items.push({
        id: "checkout",
        label: "Checkout (detached)…",
        disabled: historyBusy,
        onSelect: () => {
          if (historyRepoId !== repoId) {
            // Allow from tab graph: use checkout with confirm
            void (async () => {
              if (
                !confirm(
                  `Checkout ${c.shortHash} as detached HEAD?\nWorking tree must be clean.`,
                )
              ) {
                return;
              }
              try {
                const st = await checkoutCommit(repoId, c.hash, null);
                setStatuses((prev) => ({ ...prev, [repoId]: st }));
                setToast({ msg: `Detached at ${c.shortHash}` });
                await refresh();
              } catch (e) {
                setToast({ msg: String(e), error: true });
              }
            })();
          } else {
            void onCheckoutDetached(c.hash);
          }
        },
      });
      items.push({
        id: "branch",
        label: "Create branch here…",
        disabled: historyBusy,
        onSelect: () => {
          const name = window.prompt(
            `New branch name at ${c.shortHash}:`,
            "",
          );
          if (!name?.trim()) return;
          void (async () => {
            try {
              const st = await checkoutCommit(repoId, c.hash, name.trim());
              setStatuses((prev) => ({ ...prev, [repoId]: st }));
              setToast({ msg: `Branch ${name.trim()} at ${c.shortHash}` });
              await refresh();
              if (historyRepoId === repoId) setHistoryRepoId(null);
            } catch (e) {
              setToast({ msg: String(e), error: true });
            }
          })();
        },
      });
    }
    return items;
  }

  function branchModalItems(b: BranchInfo): ContextMenuItem[] {
    if (!branchRepoId) return [];
    const current =
      b.isCurrent || statuses[branchRepoId]?.currentBranch === b.name;
    const items: ContextMenuItem[] = [
      { type: "label", id: "lbl", label: b.name },
    ];
    if (!current) {
      items.push({
        id: "checkout",
        label: "Checkout",
        disabled: branchBusy,
        onSelect: () => {
          void onCheckout(branchRepoId, b.name);
          setBranchRepoId(null);
        },
      });
      if (b.kind === "local" || b.kind === "remote") {
        items.push({
          id: "merge",
          label: "Merge into current…",
          disabled: branchBusy,
          onSelect: () => {
            void openMerge(branchRepoId, branchRepoName, b.name);
            setBranchRepoId(null);
          },
        });
        items.push({
          id: "rebase",
          label: "Rebase onto this…",
          disabled: branchBusy,
          onSelect: () => {
            void openRebase(branchRepoId, branchRepoName, b.name);
            setBranchRepoId(null);
          },
        });
      }
      if (b.kind === "local") {
        items.push({ type: "separator", id: "s1" });
        items.push({
          id: "delete",
          label: "Delete branch…",
          danger: true,
          disabled: branchBusy,
          onSelect: () => void onDeleteBranchSafe(b.name),
        });
      }
    }
    items.push({ type: "separator", id: "s2" });
    items.push({
      id: "copy",
      label: "Copy name",
      onSelect: () => void copyText(b.name, "branch name"),
    });
    return items;
  }

  async function refreshRepoFiles(repoId: string) {
    if (focusedRepoId === repoId) void loadInspectorFiles(repoId);
    if (viewMode === "tabs" && activeTabId === repoId) void loadTabDetail(repoId);
    if (commitRepoId === repoId) void refreshChangedFiles(repoId);
  }

  async function inspectorStageFile(path: string) {
    const repoId = focusedRepoId;
    if (!repoId) return;
    try {
      await stageFiles(repoId, [path]);
      setToast({ msg: `Staged ${path}` });
      await refreshRepoFiles(repoId);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function inspectorUnstageFile(path: string) {
    const repoId = focusedRepoId;
    if (!repoId) return;
    try {
      await unstageFiles(repoId, [path]);
      setToast({ msg: `Unstaged ${path}` });
      await refreshRepoFiles(repoId);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function inspectorDiscardFile(path: string) {
    const repoId = focusedRepoId;
    if (!repoId) return;
    if (
      !confirm(
        `Discard changes to “${path}”?\nTracked files are restored from HEAD; untracked files are deleted.`,
      )
    ) {
      return;
    }
    try {
      await discardFiles(repoId, [path]);
      setToast({ msg: `Discarded ${path}` });
      await refreshRepoFiles(repoId);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function openMerge(repoId: string, name: string, preselect?: string) {
    setMergeRepoId(repoId);
    setMergeRepoName(name);
    setMergeSource(preselect ?? "");
    setMergeNoFf(false);
    setMergeSquash(false);
    setMergeResult(null);
    try {
      const list = await listBranches(repoId);
      setMergeBranches(list);
      if (!preselect) {
        const firstOther = list.find((b) => {
          const cur = statuses[repoId]?.currentBranch;
          if (b.kind === "local") return b.name !== cur;
          return b.shortName !== cur;
        });
        if (firstOther) setMergeSource(firstOther.name);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function runMergeForRepo(
    repoId: string,
    sourceBranch: string,
    options: { noFf?: boolean; squash?: boolean } = {},
    /** When true, also keep modal result state (modal-driven merge) */
    updateModalResult = false,
  ) {
    const cur = statuses[repoId]?.currentBranch ?? "current branch";
    const noFf = options.noFf ?? false;
    const squash = options.squash ?? false;
    if (
      !confirm(
        `Merge “${sourceBranch}” into “${cur}”?\n\n` +
          (squash
            ? "Squash merge: changes are staged; you commit yourself.\n"
            : noFf
              ? "No-ff: always create a merge commit.\n"
              : "Fast-forward when possible.\n") +
          "Working tree must be clean.",
      )
    ) {
      return;
    }
    setMergeBusy(true);
    if (updateModalResult) setMergeResult(null);
    try {
      const result = await mergeBranch(repoId, sourceBranch, {
        noFf: noFf && !squash,
        squash,
      });
      if (updateModalResult) setMergeResult(result);
      setToast({
        msg: result.message,
        error: !result.success,
      });
      await refresh();
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
      if (focusedRepoId === repoId) {
        void loadInspectorFiles(repoId);
      }
      // From inspector only: surface conflict UI or stage squash result
      if (!updateModalResult) {
        if (result.status === "conflict") {
          const name =
            detail?.repos.find((r) => r.id === repoId)?.name ?? "repo";
          void openMerge(repoId, name, sourceBranch);
        } else if (result.status === "squash_staged") {
          const name =
            detail?.repos.find((r) => r.id === repoId)?.name ?? "repo";
          void openCommit(repoId, name);
        }
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setMergeBusy(false);
    }
  }

  async function onRunMerge() {
    if (!mergeRepoId || !mergeSource) {
      setToast({ msg: "Pick a branch to merge in", error: true });
      return;
    }
    await runMergeForRepo(
      mergeRepoId,
      mergeSource,
      {
        noFf: mergeNoFf && !mergeSquash,
        squash: mergeSquash,
      },
      true,
    );
  }

  async function onAbortMerge(repoId: string) {
    if (!confirm("Abort the in-progress merge? Conflict resolutions will be lost.")) {
      return;
    }
    try {
      const st = await mergeAbort(repoId);
      setStatuses((prev) => ({ ...prev, [repoId]: st }));
      setMergeResult(null);
      setToast({ msg: "Merge aborted" });
      await refresh();
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  function applyRepoStatus(st: RepoStatus) {
    setStatuses((prev) => ({ ...prev, [st.repoId]: st }));
  }

  async function openRebase(repoId: string, name: string, preselect?: string) {
    setRebaseRepoId(repoId);
    setRebaseRepoName(name);
    setRebaseOntoBranch(preselect ?? "");
    setRebaseResult(null);
    try {
      const list = await listBranches(repoId);
      setRebaseBranches(list);
      if (!preselect) {
        const firstOther = list.find((b) => {
          const cur = statuses[repoId]?.currentBranch;
          if (b.kind === "local") return b.name !== cur;
          return b.shortName !== cur;
        });
        if (firstOther) setRebaseOntoBranch(firstOther.name);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onRunRebase() {
    if (!rebaseRepoId || !rebaseOntoBranch) {
      setToast({ msg: "Pick a base branch to rebase onto", error: true });
      return;
    }
    const cur = statuses[rebaseRepoId]?.currentBranch ?? "current branch";
    if (
      !confirm(
        `Rebase “${cur}” onto “${rebaseOntoBranch}”?\n\n` +
          "This rewrites commits on the current branch. Working tree must be clean.",
      )
    ) {
      return;
    }
    setRebaseBusy(true);
    setRebaseResult(null);
    try {
      const result = await rebaseOnto(rebaseRepoId, rebaseOntoBranch);
      setRebaseResult(result);
      setToast({ msg: result.message, error: !result.success });
      await refresh();
      if (viewMode === "tabs" && activeTabId === rebaseRepoId) {
        void loadTabDetail(rebaseRepoId);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setRebaseBusy(false);
    }
  }

  async function onRebaseContinue(repoId: string) {
    setRebaseBusy(true);
    try {
      const result = await rebaseContinue(repoId);
      setRebaseResult(result);
      setToast({ msg: result.message, error: !result.success });
      await refresh();
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setRebaseBusy(false);
    }
  }

  async function onRebaseSkip(repoId: string) {
    if (
      !confirm(
        "Skip this commit during rebase? Its changes will not be applied.",
      )
    ) {
      return;
    }
    setRebaseBusy(true);
    try {
      const result = await rebaseSkip(repoId);
      setRebaseResult(result);
      setToast({ msg: result.message, error: !result.success });
      await refresh();
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setRebaseBusy(false);
    }
  }

  async function onAbortRebase(repoId: string) {
    if (
      !confirm(
        "Abort the in-progress rebase? The branch returns to its pre-rebase state.",
      )
    ) {
      return;
    }
    try {
      const st = await rebaseAbort(repoId);
      applyRepoStatus(st);
      setRebaseResult(null);
      setToast({ msg: "Rebase aborted" });
      await refresh();
      if (viewMode === "tabs" && activeTabId === repoId) {
        void loadTabDetail(repoId);
      }
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
  const activeRepo =
    detail.repos.find((r) => r.id === activeTabId) ?? detail.repos[0] ?? null;
  const activeSt = activeRepo ? statuses[activeRepo.id] : undefined;
  const activeBranches = activeRepo ? (branches[activeRepo.id] ?? []) : [];
  const focusedRepo =
    detail.repos.find((r) => r.id === focusedRepoId) ?? activeRepo;
  const focusedSt = focusedRepo ? statuses[focusedRepo.id] : undefined;
  const focusedBranches = focusedRepo
    ? (branches[focusedRepo.id] ?? [])
    : [];

  return (
    <>
      {ctxMenu}
      <div
        className={`project-workspace${
          inspectorCollapsed ? " inspector-collapsed" : ""
        }`}
      >
        <div className="project-workspace-main">
      <div className="page-header">
        <div>
          <div className="eyebrow">Project workspace</div>
          <h1>{detail.project.name}</h1>
          <p className="mono">{detail.project.rootPath ?? "No root path"}</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={toggleInspector}
            title={
              inspectorCollapsed
                ? "Show worktree & branches panel"
                : "Hide worktree & branches panel"
            }
          >
            {inspectorCollapsed ? "Show inspector" : "Hide inspector"}
          </button>
          <div className="view-mode-toggle" role="group" aria-label="Repo view">
            <button
              type="button"
              className={`view-mode-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => changeViewMode("list")}
            >
              List
            </button>
            <button
              type="button"
              className={`view-mode-btn${viewMode === "tabs" ? " active" : ""}`}
              onClick={() => changeViewMode("tabs")}
            >
              Tabs
            </button>
          </div>
          <Link className="btn" to={`/projects/${projectId}/environments`}>
            Environments
          </Link>
          <Link className="btn btn-primary" to={`/projects/${projectId}/switch`}>
            <Icon name="switch" size={16} />
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
            <Icon name="plus" size={16} />
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
      ) : viewMode === "list" ? (
        <div className="repo-list">
          <div className="repo-list-meta muted">
            {detail.repos.length} repo{detail.repos.length === 1 ? "" : "s"} ·
            list view
          </div>
          {detail.repos.map((repo) => {
            const st = statuses[repo.id];
            const repoBranches = branches[repo.id] ?? [];
            const thisBusy = rowBusy === repo.id;
            const pulls = localPullCount(repoBranches);
            const focused = focusedRepoId === repo.id;
            return (
              <article
                key={repo.id}
                className={`repo-card${repo.enabled ? "" : " disabled"}${
                  focused ? " focused" : ""
                }`}
                onClick={() => setFocusedRepoId(repo.id)}
                onContextMenu={(e) => openCtx(e, repoContextItems(repo))}
              >
                <div className="repo-card-main">
                  <label
                    className="repo-enable"
                    title="Include in batch ops"
                    onClick={(e) => e.stopPropagation()}
                  >
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
                      {focused ? (
                        <span className="badge" title="Shown in inspector">
                          inspecting
                        </span>
                      ) : null}
                      {pulls > 0 ? (
                        <span
                          className="badge warn"
                          title={`${pulls} local branch(es) behind upstream — open inspector`}
                        >
                          ↓{pulls} branch{pulls === 1 ? "" : "es"}
                        </span>
                      ) : null}
                      {st?.isMerging ? (
                        <span className="badge warn">merging</span>
                      ) : null}
                      {st?.isRebasing ? (
                        <span className="badge warn">rebasing</span>
                      ) : null}
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
                    {st?.isMerging && (st.conflictFiles?.length ?? 0) > 0 ? (
                      <div className="merge-banner">
                        Conflicts in {st.conflictFiles!.length} file(s). Open
                        Merge to resolve file-by-file, or abort.
                      </div>
                    ) : null}
                    {st?.isRebasing ? (
                      <div className="merge-banner">
                        Rebase in progress
                        {(st.conflictFiles?.length ?? 0) > 0
                          ? ` · ${st.conflictFiles!.length} conflict(s)`
                          : ""}
                        . Open Rebase to continue, skip, or abort.
                      </div>
                    ) : null}
                    <div className="muted mono repo-card-path" title={repo.path}>
                      {repo.path}
                    </div>
                    {st?.lastCommit ? (
                      <div
                        className="repo-card-commit muted"
                        title={st.lastCommit}
                      >
                        <span className="commit-subject">{st.lastCommit}</span>
                        {st.lastCommitAt ? (
                          <span> · {st.lastCommitAt}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="repo-card-branch"
                    onClick={(e) => e.stopPropagation()}
                  >
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
                    >
                      {!st?.currentBranch && (
                        <option value="">
                          {st?.isDetached ? "detached…" : "Select…"}
                        </option>
                      )}
                      {st?.currentBranch &&
                        !repoBranches.some(
                          (b) =>
                            b.kind === "local" && b.name === st.currentBranch,
                        ) && (
                          <option value={st.currentBranch}>
                            {st.currentBranch}
                            {st.isDetached ? " (detached)" : ""}
                          </option>
                        )}
                      <optgroup label="Local">
                        {repoBranches
                          .filter((b) => b.kind === "local")
                          .map((b) => (
                            <option key={b.name} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Remote">
                        {repoBranches
                          .filter((b) => b.kind === "remote")
                          .map((b) => (
                            <option key={b.name} value={b.name}>
                              {b.name}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                  </div>
                </div>

                <div
                  className="repo-card-actions"
                  onClick={(e) => e.stopPropagation()}
                >
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
                    <button
                      className="btn btn-sm"
                      disabled={busy || !!st?.isDetached}
                      title="Merge another branch into current"
                      onClick={() => void openMerge(repo.id, repo.name)}
                    >
                      Merge
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy || !!st?.isDetached}
                      title="Rebase current branch onto another"
                      onClick={() => void openRebase(repo.id, repo.name)}
                    >
                      Rebase
                    </button>
                  </div>
                  <div className="repo-actions-secondary">
                    {st?.isMerging ? (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => void onAbortMerge(repo.id)}
                      >
                        Abort merge
                      </button>
                    ) : null}
                    {st?.isRebasing ? (
                      <button
                        className="btn btn-sm btn-danger"
                        disabled={busy}
                        onClick={() => void onAbortRebase(repo.id)}
                      >
                        Abort rebase
                      </button>
                    ) : null}
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
      ) : (
        /* —— Tabbed repo detail —— */
        <div className="repo-tabs-view">
          <div className="repo-tabs-bar" role="tablist" aria-label="Repositories">
            {detail.repos.map((repo) => {
              const st = statuses[repo.id];
              const selected = (activeTabId ?? detail.repos[0]?.id) === repo.id;
              const pulls = localPullCount(branches[repo.id]);
              return (
                <button
                  key={repo.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`repo-tab${selected ? " active" : ""}${
                    repo.enabled ? "" : " disabled"
                  }`}
                  onClick={() => {
                    setActiveTabId(repo.id);
                    setFocusedRepoId(repo.id);
                  }}
                  onContextMenu={(e) => openCtx(e, repoContextItems(repo))}
                  title={
                    pulls > 0
                      ? `${repo.path} · ${pulls} branch(es) behind upstream`
                      : repo.path
                  }
                >
                  <span className="repo-tab-name">{repo.name}</span>
                  {pulls > 0 ? (
                    <span className="repo-tab-pull" title={`${pulls} can pull`}>
                      ↓{pulls}
                    </span>
                  ) : null}
                  {st?.isDirty ? (
                    <span className="repo-tab-dot dirty" title="Dirty" />
                  ) : st?.error ? (
                    <span className="repo-tab-dot error" title="Error" />
                  ) : (
                    <span className="repo-tab-dot clean" title="Clean" />
                  )}
                </button>
              );
            })}
          </div>

          {activeRepo && (
            <div className="repo-tab-panel" role="tabpanel">
              <div className="repo-tab-header">
                <div className="repo-tab-header-main">
                  <div className="repo-card-title-row">
                    <h2 className="repo-card-name">{activeRepo.name}</h2>
                    <label className="option-check" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={activeRepo.enabled}
                        onChange={(e) =>
                          void onToggle(activeRepo.id, e.target.checked)
                        }
                      />
                      <span className="muted">Enabled for batch</span>
                    </label>
                    {activeSt?.isMerging ? (
                      <span className="badge warn">merging</span>
                    ) : null}
                    {activeSt?.isRebasing ? (
                      <span className="badge warn">rebasing</span>
                    ) : null}
                    {activeSt?.error ? (
                      <span className="badge err">{activeSt.error}</span>
                    ) : activeSt?.isDirty ? (
                      <span className="badge warn">dirty</span>
                    ) : (
                      <span className="badge ok">clean</span>
                    )}
                    {activeSt?.ahead != null || activeSt?.behind != null ? (
                      <span
                        className={
                          (activeSt.ahead ?? 0) > 0 ||
                          (activeSt.behind ?? 0) > 0
                            ? "sync-drift mono"
                            : "muted mono"
                        }
                      >
                        ↑{activeSt.ahead ?? 0} ↓{activeSt.behind ?? 0}
                      </span>
                    ) : null}
                  </div>
                  <div className="muted mono" title={activeRepo.path}>
                    {activeRepo.path}
                  </div>
                </div>
                <div className="repo-tab-header-side">
                  <label className="repo-branch-label muted">Branch</label>
                  <select
                    className="repo-branch-select"
                    value={activeSt?.currentBranch ?? ""}
                    disabled={
                      busy ||
                      (!branchesReady && activeBranches.length === 0) ||
                      !!activeSt?.error
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v && v !== activeSt?.currentBranch) {
                        void onCheckout(activeRepo.id, v).then(() =>
                          loadTabDetail(activeRepo.id),
                        );
                      }
                    }}
                  >
                    {!activeSt?.currentBranch && (
                      <option value="">
                        {activeSt?.isDetached ? "detached…" : "Select…"}
                      </option>
                    )}
                    {activeSt?.currentBranch &&
                      !activeBranches.some(
                        (b) =>
                          b.kind === "local" &&
                          b.name === activeSt.currentBranch,
                      ) && (
                        <option value={activeSt.currentBranch}>
                          {activeSt.currentBranch}
                        </option>
                      )}
                    <optgroup label="Local">
                      {activeBranches
                        .filter((b) => b.kind === "local")
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Remote">
                      {activeBranches
                        .filter((b) => b.kind === "remote")
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </div>
              </div>

              <div className="repo-card-actions" style={{ borderTop: "none" }}>
                <div className="repo-actions-primary">
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void runRepoOp(activeRepo.id, "Fetch", fetchRepo).then(
                        () => loadTabDetail(activeRepo.id),
                      )
                    }
                  >
                    {rowBusy === activeRepo.id ? "…" : "Fetch"}
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void runRepoOp(activeRepo.id, "Pull", pullRepo).then(
                        () => loadTabDetail(activeRepo.id),
                      )
                    }
                  >
                    Pull
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() =>
                      void runRepoOp(activeRepo.id, "Push", pushRepo).then(
                        () => loadTabDetail(activeRepo.id),
                      )
                    }
                  >
                    Push
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || !activeSt?.isDirty}
                    onClick={() =>
                      void openCommit(activeRepo.id, activeRepo.name)
                    }
                  >
                    Stage
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || !!activeSt?.isDetached}
                    onClick={() =>
                      void openMerge(activeRepo.id, activeRepo.name)
                    }
                  >
                    Merge
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || !!activeSt?.isDetached}
                    onClick={() =>
                      void openRebase(activeRepo.id, activeRepo.name)
                    }
                  >
                    Rebase
                  </button>
                  {activeSt?.isMerging ? (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => void onAbortMerge(activeRepo.id)}
                    >
                      Abort merge
                    </button>
                  ) : null}
                  {activeSt?.isRebasing ? (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => void onAbortRebase(activeRepo.id)}
                    >
                      Abort rebase
                    </button>
                  ) : null}
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      void openBranches(activeRepo.id, activeRepo.name)
                    }
                  >
                    Branches
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={busy}
                    onClick={() => void onOpenFolder(activeRepo.id)}
                  >
                    Folder
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={busy || tabDetailLoading}
                    onClick={() => void loadTabDetail(activeRepo.id)}
                  >
                    Refresh detail
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy}
                    onClick={() =>
                      void onRemove(activeRepo.id, activeRepo.name)
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>

              {tabDetailError && (
                <div className="card" style={{ borderColor: "var(--danger)" }}>
                  <span className="badge err">{tabDetailError}</span>
                </div>
              )}

              <div className="repo-tab-columns">
                <section className="repo-tab-section working-tree-section">
                  <div className="repo-tab-section-head">
                    <h3>Working tree</h3>
                    <span className="muted">
                      {tabFiles.length} change
                      {tabFiles.length === 1 ? "" : "s"}
                      {tabFiles.filter((f) => f.status === "?").length > 0
                        ? ` · ${tabFiles.filter((f) => f.status === "?").length} untracked`
                        : ""}
                    </span>
                  </div>
                  {tabDetailLoading ? (
                    <p className="muted">Loading…</p>
                  ) : tabFiles.length === 0 ? (
                    <p className="muted">Clean — no modified or untracked files</p>
                  ) : (
                    <div className="tab-file-list">
                      {tabFiles.map((f) => (
                        <div
                          key={f.path}
                          className="tab-file-row"
                          onContextMenu={(e) => {
                            const items: ContextMenuItem[] = [
                              { type: "label", id: "lbl", label: f.path },
                              {
                                id: "stage-modal",
                                label: "Open in stage / commit…",
                                onSelect: () =>
                                  void openCommit(
                                    activeRepo.id,
                                    activeRepo.name,
                                  ),
                              },
                              {
                                id: "copy",
                                label: "Copy path",
                                onSelect: () => void copyText(f.path, "path"),
                              },
                            ];
                            if (f.unstaged) {
                              items.splice(1, 0, {
                                id: "stage",
                                label: "Stage",
                                onSelect: () => {
                                  void stageFiles(activeRepo.id, [f.path])
                                    .then(() => {
                                      setToast({ msg: `Staged ${f.path}` });
                                      void loadTabDetail(activeRepo.id);
                                      void refresh();
                                    })
                                    .catch((err) =>
                                      setToast({
                                        msg: String(err),
                                        error: true,
                                      }),
                                    );
                                },
                              });
                            }
                            if (f.staged) {
                              items.splice(1, 0, {
                                id: "unstage",
                                label: "Unstage",
                                onSelect: () => {
                                  void unstageFiles(activeRepo.id, [f.path])
                                    .then(() => {
                                      setToast({ msg: `Unstaged ${f.path}` });
                                      void loadTabDetail(activeRepo.id);
                                      void refresh();
                                    })
                                    .catch((err) =>
                                      setToast({
                                        msg: String(err),
                                        error: true,
                                      }),
                                    );
                                },
                              });
                            }
                            openCtx(e, items);
                          }}
                        >
                          <span
                            className={`file-status mono status-${
                              f.status === "?"
                                ? "untracked"
                                : f.status.toLowerCase()
                            }`}
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
                          <span className="mono file-path" title={f.path}>
                            {f.path}
                          </span>
                          {f.staged && !f.unstaged && (
                            <span className="badge ok">staged</span>
                          )}
                          {!f.staged && f.unstaged && (
                            <span className="badge warn">
                              {f.status === "?" ? "untracked" : "unstaged"}
                            </span>
                          )}
                          {f.staged && f.unstaged && (
                            <span className="badge warn">partial</span>
                          )}
                        </div>
                      ))}
                      <div className="actions" style={{ marginTop: "0.5rem" }}>
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={!activeSt?.isDirty}
                          onClick={() =>
                            void openCommit(activeRepo.id, activeRepo.name)
                          }
                        >
                          Open stage / commit
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                <section className="repo-tab-section commit-history-section">
                  <div className="repo-tab-section-head">
                    <div>
                      <h3>Commit history</h3>
                      <small className="muted">All local and remote branches</small>
                    </div>
                    <span className="muted">
                      {tabCommits.length} commit
                      {tabCommits.length === 1 ? "" : "s"} loaded
                    </span>
                  </div>
                  {tabDetailLoading ? (
                    <p className="muted">Loading…</p>
                  ) : tabCommits.length === 0 ? (
                    <p className="muted">No commits</p>
                  ) : (
                    <div className="tab-commit-graph-wrap">
                      <CommitGraph
                        commits={tabCommits}
                        onContextMenu={(e, c) =>
                          openCtx(e, commitContextItems(c, activeRepo.id))
                        }
                      />
                      <div className="actions" style={{ marginTop: "0.5rem" }}>
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            void openHistory(activeRepo.id, activeRepo.name)
                          }
                        >
                          Open expanded history…
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      )}
        </div>

        <RepoInspector
          collapsed={inspectorCollapsed}
          onToggleCollapsed={toggleInspector}
          repo={focusedRepo}
          status={focusedSt}
          branches={focusedBranches}
          files={
            viewMode === "tabs" &&
            activeTabId &&
            focusedRepo?.id === activeTabId
              ? tabFiles
              : inspectorFiles
          }
          filesLoading={
            viewMode === "tabs" &&
            activeTabId &&
            focusedRepo?.id === activeTabId
              ? tabDetailLoading
              : inspectorFilesLoading
          }
          busy={busy}
          mergeBusy={mergeBusy}
          onRefreshFiles={() => {
            if (!focusedRepo) return;
            if (viewMode === "tabs" && activeTabId === focusedRepo.id) {
              void loadTabDetail(focusedRepo.id);
            } else {
              void loadInspectorFiles(focusedRepo.id);
            }
          }}
          onOpenStage={() => {
            if (focusedRepo) void openCommit(focusedRepo.id, focusedRepo.name);
          }}
          onCheckout={(branch) => {
            if (focusedRepo) void onCheckout(focusedRepo.id, branch);
          }}
          onOpenBranches={() => {
            if (focusedRepo) void openBranches(focusedRepo.id, focusedRepo.name);
          }}
          onFetch={() => {
            if (!focusedRepo) return;
            void runRepoOp(focusedRepo.id, "Fetch", fetchRepo);
          }}
          onMerge={(sourceBranch, options) => {
            if (!focusedRepo) return;
            void runMergeForRepo(focusedRepo.id, sourceBranch, options);
          }}
          onAbortMerge={() => {
            if (!focusedRepo) return;
            void onAbortMerge(focusedRepo.id);
          }}
          onOpenMergeModal={(preselect) => {
            if (!focusedRepo) return;
            void openMerge(focusedRepo.id, focusedRepo.name, preselect);
          }}
          onRebase={(onto) => {
            if (!focusedRepo) return;
            void openRebase(focusedRepo.id, focusedRepo.name, onto);
          }}
          onOpenFolder={() => {
            if (!focusedRepo) return;
            void onOpenFolder(focusedRepo.id);
          }}
          onOpenHistory={() => {
            if (!focusedRepo) return;
            void openHistory(focusedRepo.id, focusedRepo.name);
          }}
          onPull={() => {
            if (!focusedRepo) return;
            void runRepoOp(focusedRepo.id, "Pull", pullRepo);
          }}
          onPush={() => {
            if (!focusedRepo) return;
            void runRepoOp(focusedRepo.id, "Push", pushRepo);
          }}
          onStageFile={(path) => void inspectorStageFile(path)}
          onUnstageFile={(path) => void inspectorUnstageFile(path)}
          onDiscardFile={(path) => void inspectorDiscardFile(path)}
          onToast={(msg, error) => setToast({ msg, error })}
        />
      </div>

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
                          onContextMenu={(e) =>
                            openCtx(
                              e,
                              changedFileContextItems(f, { showDiff: true }),
                            )
                          }
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
            className="modal modal-wide history-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="history-modal-heading">
              <div>
                <h2>History — {historyName}</h2>
                <p className="muted">
                  {historyEntries.length} commit
                  {historyEntries.length === 1 ? "" : "s"} loaded · all branches
                </p>
              </div>
              <button
                className="btn"
                disabled={historyBusy}
                onClick={() => setHistoryRepoId(null)}
              >
                Close
              </button>
            </div>
            <div className="card history-branch-controls">
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
              <div className="history-graph-wrap">
                <CommitGraph
                  commits={historyEntries}
                  onContextMenu={(e, c) =>
                    openCtx(e, commitContextItems(c, historyRepoId))
                  }
                  actions={(e) => (
                    <div className="row-actions">
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
                  )}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Merge modal */}
      {mergeRepoId && (
        <div className="modal-backdrop" onClick={() => setMergeRepoId(null)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Merge — {mergeRepoName}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Merge another branch into{" "}
              <strong className="mono">
                {statuses[mergeRepoId]?.currentBranch ?? "current branch"}
              </strong>
              . Working tree must be clean.
            </p>

            {statuses[mergeRepoId]?.isMerging ? (
              <div className="merge-panel conflict">
                <strong>Merge in progress</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {(statuses[mergeRepoId]?.conflictFiles?.length ?? 0) > 0
                    ? "Resolve each file below (Ours / Theirs / Mark resolved), then commit."
                    : "All conflicts resolved. Commit to finish, or abort."}
                </p>
                {(statuses[mergeRepoId]?.conflictFiles?.length ?? 0) > 0 ? (
                  <ConflictPanel
                    repoId={mergeRepoId}
                    files={statuses[mergeRepoId]!.conflictFiles ?? []}
                    mode="merge"
                    busy={mergeBusy}
                    onStatus={(st) => {
                      applyRepoStatus(st);
                      setMergeResult((prev) =>
                        prev
                          ? {
                              ...prev,
                              conflictFiles: st.conflictFiles ?? [],
                              message:
                                (st.conflictFiles?.length ?? 0) === 0
                                  ? "Conflicts resolved — commit to finish the merge."
                                  : prev.message,
                            }
                          : prev,
                      );
                    }}
                    onToast={(msg, error) => setToast({ msg, error })}
                  />
                ) : null}
                <div className="actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    className="btn btn-primary"
                    disabled={mergeBusy}
                    onClick={() => {
                      void openCommit(mergeRepoId, mergeRepoName);
                    }}
                  >
                    Open stage / commit
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={mergeBusy}
                    onClick={() => void onAbortMerge(mergeRepoId)}
                  >
                    Abort merge
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <label>
                  Branch to merge in
                  <select
                    value={mergeSource}
                    onChange={(e) => setMergeSource(e.target.value)}
                    disabled={mergeBusy}
                  >
                    <option value="">— select branch —</option>
                    <optgroup label="Local">
                      {mergeBranches
                        .filter(
                          (b) =>
                            b.kind === "local" &&
                            b.name !==
                              statuses[mergeRepoId]?.currentBranch,
                        )
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Remote">
                      {mergeBranches
                        .filter((b) => b.kind === "remote")
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>

                <label className="option-check">
                  <input
                    type="checkbox"
                    checked={mergeNoFf}
                    disabled={mergeBusy || mergeSquash}
                    onChange={(e) => setMergeNoFf(e.target.checked)}
                  />
                  <span>
                    Create merge commit (no fast-forward)
                    <span className="muted"> — git merge --no-ff</span>
                  </span>
                </label>
                <label className="option-check">
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
                    Squash into one commit (stage only)
                    <span className="muted">
                      {" "}
                      — you write the commit message after
                    </span>
                  </span>
                </label>

                {mergeResult && (
                  <div
                    className={`merge-panel${
                      mergeResult.status === "conflict"
                        ? " conflict"
                        : mergeResult.success
                          ? " ok"
                          : ""
                    }`}
                  >
                    <span
                      className={`badge ${
                        mergeResult.success ? "ok" : "err"
                      }`}
                    >
                      {mergeResult.status}
                    </span>
                    <p style={{ margin: "0.4rem 0 0" }}>{mergeResult.message}</p>
                    {mergeResult.conflictFiles.length > 0 && (
                      <ul className="result-list">
                        {mergeResult.conflictFiles.map((f) => (
                          <li key={f} className="mono">
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                    {mergeResult.status === "squash_staged" && (
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ marginTop: "0.5rem" }}
                        onClick={() =>
                          void openCommit(mergeRepoId, mergeRepoName)
                        }
                      >
                        Commit squash result
                      </button>
                    )}
                    {mergeResult.status === "conflict" && (
                      <>
                        {mergeResult.conflictFiles.length > 0 ? (
                          <ConflictPanel
                            repoId={mergeRepoId}
                            files={
                              statuses[mergeRepoId]?.conflictFiles ??
                              mergeResult.conflictFiles
                            }
                            mode="merge"
                            busy={mergeBusy}
                            onStatus={(st) => {
                              applyRepoStatus(st);
                              setMergeResult((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      conflictFiles: st.conflictFiles ?? [],
                                      success:
                                        (st.conflictFiles?.length ?? 0) === 0,
                                      message:
                                        (st.conflictFiles?.length ?? 0) === 0
                                          ? "Conflicts resolved — commit to finish the merge."
                                          : prev.message,
                                    }
                                  : prev,
                              );
                            }}
                            onToast={(msg, error) => setToast({ msg, error })}
                          />
                        ) : null}
                        <div className="actions" style={{ marginTop: "0.5rem" }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() =>
                              void openCommit(mergeRepoId, mergeRepoName)
                            }
                          >
                            Open stage / commit
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => void onAbortMerge(mergeRepoId)}
                          >
                            Abort merge
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="actions" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    disabled={mergeBusy}
                    onClick={() => setMergeRepoId(null)}
                  >
                    Close
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={mergeBusy || !mergeSource}
                    onClick={() => void onRunMerge()}
                  >
                    {mergeBusy ? "Merging…" : "Merge into current"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rebase modal */}
      {rebaseRepoId && (
        <div className="modal-backdrop" onClick={() => setRebaseRepoId(null)}>
          <div
            className="modal modal-wide"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Rebase — {rebaseRepoName}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Replay commits from{" "}
              <strong className="mono">
                {statuses[rebaseRepoId]?.currentBranch ?? "current branch"}
              </strong>{" "}
              onto another base. Working tree must be clean.
            </p>

            {statuses[rebaseRepoId]?.isRebasing ? (
              <div className="merge-panel conflict">
                <strong>Rebase in progress</strong>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {(statuses[rebaseRepoId]?.conflictFiles?.length ?? 0) > 0
                    ? "Resolve conflicts below, then Continue. Skip drops this commit; Abort undoes the rebase."
                    : "No remaining conflicts — Continue to finish, Skip, or Abort."}
                </p>
                {(statuses[rebaseRepoId]?.conflictFiles?.length ?? 0) > 0 ? (
                  <ConflictPanel
                    repoId={rebaseRepoId}
                    files={statuses[rebaseRepoId]!.conflictFiles ?? []}
                    mode="rebase"
                    busy={rebaseBusy}
                    onStatus={(st) => {
                      applyRepoStatus(st);
                      setRebaseResult((prev) =>
                        prev
                          ? {
                              ...prev,
                              conflictFiles: st.conflictFiles ?? [],
                              message:
                                (st.conflictFiles?.length ?? 0) === 0
                                  ? "Conflicts cleared — press Continue."
                                  : prev.message,
                            }
                          : {
                              repoId: rebaseRepoId,
                              success: false,
                              status: "conflict",
                              message:
                                (st.conflictFiles?.length ?? 0) === 0
                                  ? "Conflicts cleared — press Continue."
                                  : "Resolve remaining conflicts",
                              conflictFiles: st.conflictFiles ?? [],
                            },
                      );
                    }}
                    onToast={(msg, error) => setToast({ msg, error })}
                  />
                ) : null}
                {rebaseResult && (
                  <p style={{ margin: "0.5rem 0 0" }}>{rebaseResult.message}</p>
                )}
                <div className="actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    className="btn btn-primary"
                    disabled={
                      rebaseBusy ||
                      (statuses[rebaseRepoId]?.conflictFiles?.length ?? 0) > 0
                    }
                    onClick={() => void onRebaseContinue(rebaseRepoId)}
                  >
                    {rebaseBusy ? "Working…" : "Continue rebase"}
                  </button>
                  <button
                    className="btn"
                    disabled={rebaseBusy}
                    onClick={() => void onRebaseSkip(rebaseRepoId)}
                  >
                    Skip commit
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={rebaseBusy}
                    onClick={() => void onAbortRebase(rebaseRepoId)}
                  >
                    Abort rebase
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={rebaseBusy}
                    onClick={() => setRebaseRepoId(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                <label>
                  Rebase onto
                  <select
                    value={rebaseOntoBranch}
                    onChange={(e) => setRebaseOntoBranch(e.target.value)}
                    disabled={rebaseBusy}
                  >
                    <option value="">— select branch —</option>
                    <optgroup label="Local">
                      {rebaseBranches
                        .filter(
                          (b) =>
                            b.kind === "local" &&
                            b.name !==
                              statuses[rebaseRepoId]?.currentBranch,
                        )
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Remote">
                      {rebaseBranches
                        .filter((b) => b.kind === "remote")
                        .map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                </label>

                {rebaseResult && (
                  <div
                    className={`merge-panel${
                      rebaseResult.status === "conflict"
                        ? " conflict"
                        : rebaseResult.success
                          ? " ok"
                          : ""
                    }`}
                  >
                    <span
                      className={`badge ${
                        rebaseResult.success ? "ok" : "err"
                      }`}
                    >
                      {rebaseResult.status}
                    </span>
                    <p style={{ margin: "0.4rem 0 0" }}>{rebaseResult.message}</p>
                    {rebaseResult.status === "conflict" && (
                      <>
                        {(
                          statuses[rebaseRepoId]?.conflictFiles ??
                          rebaseResult.conflictFiles
                        ).length > 0 ? (
                          <ConflictPanel
                            repoId={rebaseRepoId}
                            files={
                              statuses[rebaseRepoId]?.conflictFiles ??
                              rebaseResult.conflictFiles
                            }
                            mode="rebase"
                            busy={rebaseBusy}
                            onStatus={(st) => {
                              applyRepoStatus(st);
                              setRebaseResult((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      conflictFiles: st.conflictFiles ?? [],
                                      message:
                                        (st.conflictFiles?.length ?? 0) === 0
                                          ? "Conflicts cleared — press Continue."
                                          : prev.message,
                                    }
                                  : prev,
                              );
                            }}
                            onToast={(msg, error) => setToast({ msg, error })}
                          />
                        ) : null}
                        <div className="actions" style={{ marginTop: "0.5rem" }}>
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={
                              rebaseBusy ||
                              (
                                statuses[rebaseRepoId]?.conflictFiles ??
                                rebaseResult.conflictFiles
                              ).length > 0
                            }
                            onClick={() => void onRebaseContinue(rebaseRepoId)}
                          >
                            Continue
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={rebaseBusy}
                            onClick={() => void onRebaseSkip(rebaseRepoId)}
                          >
                            Skip
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={rebaseBusy}
                            onClick={() => void onAbortRebase(rebaseRepoId)}
                          >
                            Abort
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="actions" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    disabled={rebaseBusy}
                    onClick={() => setRebaseRepoId(null)}
                  >
                    Close
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={rebaseBusy || !rebaseOntoBranch}
                    onClick={() => void onRunRebase()}
                  >
                    {rebaseBusy ? "Rebasing…" : "Start rebase"}
                  </button>
                </div>
              </div>
            )}
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
                  className="btn"
                  disabled={branchBusy}
                  title="Fetch remotes so remote branches appear"
                  onClick={() => {
                    if (!branchRepoId) return;
                    void runRepoOp(branchRepoId, "Fetch", fetchRepo).then(
                      async () => {
                        const list = await listBranches(branchRepoId);
                        setBranchList(list);
                      },
                    );
                  }}
                >
                  Fetch remotes
                </button>
                <button
                  className="btn btn-primary"
                  disabled={branchBusy || !newBranchName.trim()}
                  onClick={() => void onCreateBranch()}
                >
                  {branchBusy ? "Working…" : "Create branch"}
                </button>
              </div>
              <div className="branch-modal-sections">
                <div>
                  <div className="repo-tab-section-head">
                    <h3>Local</h3>
                  </div>
                  <div className="file-list" style={{ maxHeight: 160 }}>
                    {branchList.filter((b) => b.kind === "local").length ===
                    0 ? (
                      <p className="muted" style={{ padding: "0.5rem" }}>
                        No local branches
                      </p>
                    ) : (
                      branchList
                        .filter((b) => b.kind === "local")
                        .map((b) => {
                          const current =
                            b.isCurrent ||
                            statuses[branchRepoId]?.currentBranch === b.name;
                          const ahead = b.ahead ?? 0;
                          const behind = b.behind ?? 0;
                          return (
                            <div
                              key={b.name}
                              className="file-row-wrap"
                              onContextMenu={(e) =>
                                openCtx(e, branchModalItems(b))
                              }
                            >
                              <div className="branch-row-meta">
                                <span className="mono file-path">
                                  {b.name}
                                  {current ? " ★" : ""}
                                </span>
                                <span className="branch-sync muted mono">
                                  {b.upstreamGone
                                    ? "upstream gone"
                                    : b.upstream
                                      ? `${b.upstream} · ↑${ahead} ↓${behind}`
                                      : "no upstream"}
                                </span>
                                {behind > 0 ? (
                                  <span className="badge warn">pull available</span>
                                ) : null}
                              </div>
                              <div className="row-actions">
                                {!current && (
                                  <>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      onClick={() => {
                                        void onCheckout(branchRepoId, b.name);
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Checkout
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      title="Merge this branch into current"
                                      onClick={() => {
                                        void openMerge(
                                          branchRepoId,
                                          branchRepoName,
                                          b.name,
                                        );
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Merge into current
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      title="Rebase current branch onto this"
                                      onClick={() => {
                                        void openRebase(
                                          branchRepoId,
                                          branchRepoName,
                                          b.name,
                                        );
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Rebase onto this
                                    </button>
                                    <button
                                      className="btn btn-sm btn-danger"
                                      disabled={branchBusy}
                                      onClick={() =>
                                        void onDeleteBranchSafe(b.name)
                                      }
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
                <div>
                  <div className="repo-tab-section-head">
                    <h3>Remote</h3>
                    <span className="muted">checkout creates tracking branch</span>
                  </div>
                  <div className="file-list" style={{ maxHeight: 180 }}>
                    {branchList.filter((b) => b.kind === "remote").length ===
                    0 ? (
                      <p className="muted" style={{ padding: "0.5rem" }}>
                        No remote branches — try Fetch remotes
                      </p>
                    ) : (
                      branchList
                        .filter((b) => b.kind === "remote")
                        .map((b) => {
                          const localExists = branchList.some(
                            (l) =>
                              l.kind === "local" && l.name === b.shortName,
                          );
                          const current =
                            statuses[branchRepoId]?.currentBranch ===
                            b.shortName;
                          return (
                            <div
                              key={b.name}
                              className="file-row-wrap"
                              onContextMenu={(e) =>
                                openCtx(e, branchModalItems(b))
                              }
                            >
                              <span className="mono file-path" title={b.name}>
                                {b.name}
                                {current ? " ★" : ""}
                                {localExists && !current ? (
                                  <span className="muted"> (has local)</span>
                                ) : null}
                              </span>
                              <div className="row-actions">
                                {!current && (
                                  <>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      title={`Checkout ${b.shortName} tracking ${b.name}`}
                                      onClick={() => {
                                        void onCheckout(branchRepoId, b.name);
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Checkout
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      onClick={() => {
                                        void openMerge(
                                          branchRepoId,
                                          branchRepoName,
                                          b.name,
                                        );
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Merge into current
                                    </button>
                                    <button
                                      className="btn btn-sm"
                                      disabled={branchBusy}
                                      title="Rebase current branch onto this"
                                      onClick={() => {
                                        void openRebase(
                                          branchRepoId,
                                          branchRepoName,
                                          b.name,
                                        );
                                        setBranchRepoId(null);
                                      }}
                                    >
                                      Rebase onto this
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
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
