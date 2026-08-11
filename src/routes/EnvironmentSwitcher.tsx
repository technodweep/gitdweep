import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useParams } from "react-router-dom";
import {
  getEnvironmentMap,
  getProject,
  getProjectRepoStatuses,
  listEnvironments,
  switchEnvironment,
} from "../lib/api";
import type {
  Environment,
  EnvironmentBranch,
  ProjectDetail,
  RepoStatus,
  SwitchProgress,
  SwitchResult,
} from "../lib/types";
import { Toast } from "../components/Toast";

export function EnvironmentSwitcher() {
  const { projectId = "" } = useParams();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [envId, setEnvId] = useState<string | null>(null);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [progress, setProgress] = useState<Record<string, SwitchProgress>>({});
  const [results, setResults] = useState<SwitchResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [stashIfDirty, setStashIfDirty] = useState(false);
  const [fetchFirst, setFetchFirst] = useState(false);
  const [popStashAfter, setPopStashAfter] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const d = await getProject(projectId);
      setDetail(d);
      const e = await listEnvironments(projectId);
      setEnvs(e);
      setEnvId((prev) => {
        if (prev && e.some((x) => x.id === prev)) return prev;
        return e.find((x) => x.isDefault)?.id ?? e[0]?.id ?? null;
      });
      const st = await getProjectRepoStatuses(projectId);
      const map: Record<string, RepoStatus> = {};
      for (const s of st) map[s.repoId] = s;
      setStatuses(map);
    } catch (err) {
      setToast({ msg: String(err), error: true });
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!envId) {
      setBranchMap({});
      return;
    }
    void (async () => {
      try {
        const map: EnvironmentBranch[] = await getEnvironmentMap(envId);
        const obj: Record<string, string> = {};
        for (const m of map) obj[m.repoId] = m.branch;
        setBranchMap(obj);
      } catch (err) {
        setToast({ msg: String(err), error: true });
      }
    })();
  }, [envId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<SwitchProgress>("switch-progress", (event) => {
      const p = event.payload;
      setProgress((prev) => ({ ...prev, [p.repoId]: p }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Pop stash only makes sense when stash is enabled
  useEffect(() => {
    if (!stashIfDirty) setPopStashAfter(false);
  }, [stashIfDirty]);

  async function onSwitch() {
    if (!envId) return;
    const env = envs.find((e) => e.id === envId);
    const dirtyCount = enabledRepos.filter(
      (r) => statuses[r.id]?.isDirty,
    ).length;
    const parts = [
      `Switch all enabled repos to environment “${env?.name ?? envId}”?`,
    ];
    if (stashIfDirty) {
      parts.push("Dirty repos will be stashed before checkout.");
      if (popStashAfter) {
        parts.push("Stash will be popped after a successful checkout.");
      }
    } else if (dirtyCount > 0) {
      parts.push(
        `${dirtyCount} dirty repo(s) will fail unless you enable stash.`,
      );
    }
    if (fetchFirst) {
      parts.push("Each repo will fetch before checkout.");
    }
    if (!confirm(parts.join("\n\n"))) {
      return;
    }
    setRunning(true);
    setResults(null);
    setProgress({});
    try {
      const res = await switchEnvironment(projectId, envId, {
        stashIfDirty,
        fetchFirst,
        popStashAfter: stashIfDirty && popStashAfter,
      });
      setResults(res);
      const ok = res.filter((r) => r.success).length;
      const fail = res.length - ok;
      setToast({
        msg: `Done: ${ok} succeeded, ${fail} failed/skipped`,
        error: fail > 0,
      });
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setRunning(false);
    }
  }

  const enabledRepos = detail?.repos.filter((r) => r.enabled) ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Switch environment</h1>
          <p>
            Checkout every enabled repo to its target branch for the selected
            environment.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void refresh()} disabled={running}>
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void onSwitch()}
            disabled={running || !envId || enabledRepos.length === 0}
          >
            {running ? "Switching…" : "Switch all to environment"}
          </button>
        </div>
      </div>

      <div className="card options-bar">
        <label className="option-check">
          <input
            type="checkbox"
            checked={stashIfDirty}
            disabled={running}
            onChange={(e) => setStashIfDirty(e.target.checked)}
          />
          <span>
            Stash if dirty
            <span className="muted">
              {" "}
              — auto-stash uncommitted changes before checkout
            </span>
          </span>
        </label>
        <label className="option-check" style={{ marginLeft: "1.5rem" }}>
          <input
            type="checkbox"
            checked={popStashAfter}
            disabled={running || !stashIfDirty}
            onChange={(e) => setPopStashAfter(e.target.checked)}
          />
          <span>
            Pop stash after switch
            <span className="muted">
              {" "}
              — restore stash only on repos that were stashed
            </span>
          </span>
        </label>
        <label className="option-check">
          <input
            type="checkbox"
            checked={fetchFirst}
            disabled={running}
            onChange={(e) => setFetchFirst(e.target.checked)}
          />
          <span>
            Fetch before switch
            <span className="muted"> — git fetch --all --prune per repo</span>
          </span>
        </label>
      </div>

      <div className="tabs">
        {envs.map((env) => (
          <button
            key={env.id}
            className={`tab${env.id === envId ? " active" : ""}`}
            onClick={() => setEnvId(env.id)}
            disabled={running}
          >
            {env.name}
            {env.isDefault ? " ★" : ""}
          </button>
        ))}
      </div>

      {!detail ? (
        <div className="empty">Loading…</div>
      ) : enabledRepos.length === 0 ? (
        <div className="card empty">No enabled repositories.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Repo</th>
                <th>Current</th>
                <th>Target</th>
                <th>Progress / result</th>
              </tr>
            </thead>
            <tbody>
              {enabledRepos.map((repo) => {
                const st = statuses[repo.id];
                const target = branchMap[repo.id] ?? "";
                const prog = progress[repo.id];
                const result = results?.find((r) => r.repoId === repo.id);
                const already =
                  !!target && st?.currentBranch === target && !result && !prog;
                return (
                  <tr key={repo.id}>
                    <td>
                      <strong>{repo.name}</strong>
                    </td>
                    <td className="mono">
                      {st?.currentBranch ?? "—"}
                      {st?.isDirty ? (
                        <span className="badge warn" style={{ marginLeft: 8 }}>
                          dirty
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">
                      {target || "— not set —"}
                      {already ? (
                        <span className="badge ok" style={{ marginLeft: 8 }}>
                          already
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {result ? (
                        <span
                          className={`badge ${result.success ? "ok" : "err"}`}
                          title={result.message}
                        >
                          {result.message}
                          {result.stashed ? " · stashed" : ""}
                        </span>
                      ) : prog ? (
                        <span
                          className={`badge ${
                            prog.status === "error"
                              ? "err"
                              : prog.status === "ok"
                                ? "ok"
                                : "warn"
                          }`}
                        >
                          {prog.message}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
