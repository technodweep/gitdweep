import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addRepo,
  checkoutBranch,
  fetchAllRepos,
  getProject,
  getProjectRepoStatuses,
  listProjectBranches,
  pickFolder,
  pullAll,
  pushAll,
  removeRepo,
  scanRepos,
  setRepoEnabled,
} from "../lib/api";
import type {
  ProjectDetail as ProjectDetailType,
  PullResult,
  RepoStatus,
} from "../lib/types";
import { Toast } from "../components/Toast";

type BatchKind = "pull" | "fetch" | "push";

export function ProjectDetail() {
  const { projectId = "" } = useParams();
  const [detail, setDetail] = useState<ProjectDetailType | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [branches, setBranches] = useState<Record<string, string[]>>({});
  const [branchesReady, setBranchesReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [batchBusy, setBatchBusy] = useState<BatchKind | null>(null);
  const [batchResults, setBatchResults] = useState<{
    kind: BatchKind;
    items: PullResult[];
  } | null>(null);
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

  if (loading && !detail) {
    return <div className="empty">Loading…</div>;
  }
  if (!detail) {
    return <div className="empty">Project not found</div>;
  }

  const busy = batchBusy !== null;

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
                "Fetch (all remotes, prune) for {n} enabled repo(s)?",
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
                "Pull (ff-only) for {n} enabled repo(s)? Dirty repos will fail.",
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
              void runBatch(
                "push",
                "Push current branch for {n} enabled repo(s)?\n\nRepos without upstream will set origin/<branch>.",
                pushAll,
              )
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Repo</th>
                <th>Branch</th>
                <th>Sync</th>
                <th>Last commit</th>
                <th>Status</th>
                <th>Change branch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {detail.repos.map((repo) => {
                const st = statuses[repo.id];
                const repoBranches = branches[repo.id] ?? [];
                return (
                  <tr key={repo.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={repo.enabled}
                        onChange={(e) =>
                          void onToggle(repo.id, e.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <strong>{repo.name}</strong>
                      <div className="muted mono">{repo.path}</div>
                    </td>
                    <td className="mono">
                      {st?.currentBranch ?? "—"}
                      {st?.isDetached ? " (detached)" : ""}
                    </td>
                    <td className="mono">
                      {st?.ahead != null || st?.behind != null ? (
                        <span
                          title="Ahead / behind upstream"
                          className={
                            (st.ahead ?? 0) > 0 || (st.behind ?? 0) > 0
                              ? "sync-drift"
                              : "muted"
                          }
                        >
                          ↑{st.ahead ?? 0} ↓{st.behind ?? 0}
                        </span>
                      ) : (
                        <span className="muted" title="No upstream set">
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      {st?.lastCommit ? (
                        <div className="last-commit">
                          <div className="commit-subject" title={st.lastCommit}>
                            {st.lastCommit}
                          </div>
                          {st.lastCommitAt && (
                            <div className="muted">{st.lastCommitAt}</div>
                          )}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
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
                    </td>
                    <td>
                      <select
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
                            {!branchesReady && repoBranches.length === 0
                              ? "Loading branches…"
                              : "Select branch…"}
                          </option>
                        )}
                        {st?.currentBranch &&
                          !repoBranches.includes(st.currentBranch) && (
                            <option value={st.currentBranch}>
                              {st.currentBranch}
                            </option>
                          )}
                        {repoBranches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        disabled={busy}
                        onClick={() => void onRemove(repo.id, repo.name)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
