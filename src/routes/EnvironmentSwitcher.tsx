import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useParams } from "react-router-dom";
import {
  getEnvironmentMap,
  getProject,
  getProjectRepoStatuses,
  listEnvironments,
  previewSwitchEnvironment,
  switchEnvironment,
} from "../lib/api";
import type {
  Environment,
  EnvironmentBranch,
  ProjectDetail,
  RepoStatus,
  SwitchPreviewItem,
  SwitchProgress,
  SwitchResult,
} from "../lib/types";
import { Toast } from "../components/Toast";
import { Icon } from "../components/Icon";

function previewBadgeClass(action: string): string {
  switch (action) {
    case "skip":
      return "ok";
    case "will_switch":
      return "ok";
    case "will_stash":
      return "warn";
    case "will_fail":
    case "no_target":
      return "err";
    default:
      return "warn";
  }
}

export function EnvironmentSwitcher() {
  const { projectId = "" } = useParams();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [envId, setEnvId] = useState<string | null>(null);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, RepoStatus>>({});
  const [preview, setPreview] = useState<Record<string, SwitchPreviewItem>>({});
  const [progress, setProgress] = useState<Record<string, SwitchProgress>>({});
  const [results, setResults] = useState<SwitchResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [stashIfDirty, setStashIfDirty] = useState(false);
  const [fetchFirst, setFetchFirst] = useState(false);
  const [popStashAfter, setPopStashAfter] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  const options = {
    stashIfDirty,
    fetchFirst,
    popStashAfter: stashIfDirty && popStashAfter,
  };

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

  // Live dry-run preview when env / options change
  useEffect(() => {
    if (!envId || running) return;
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const items = await previewSwitchEnvironment(projectId, envId, options);
        if (cancelled) return;
        const map: Record<string, SwitchPreviewItem> = {};
        for (const i of items) map[i.repoId] = i;
        setPreview(map);
      } catch (err) {
        if (!cancelled) setToast({ msg: String(err), error: true });
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options fields listed explicitly
  }, [projectId, envId, stashIfDirty, fetchFirst, popStashAfter, running]);

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

  useEffect(() => {
    if (!stashIfDirty) setPopStashAfter(false);
  }, [stashIfDirty]);

  async function onSwitch() {
    if (!envId) return;
    const env = envs.find((e) => e.id === envId);
    const willFail = Object.values(preview).filter(
      (p) => p.action === "will_fail" || p.action === "no_target",
    ).length;
    const willChange = Object.values(preview).filter(
      (p) => p.action === "will_switch" || p.action === "will_stash",
    ).length;

    const parts = [
      `Switch all enabled repos to environment “${env?.name ?? envId}”?`,
      `Preview: ${willChange} will change, ${willFail} will fail/skip config.`,
    ];
    if (stashIfDirty) {
      parts.push("Dirty repos will be stashed before checkout.");
      if (popStashAfter) parts.push("Stash will be popped after success.");
    }
    if (fetchFirst) parts.push("Each repo will fetch before checkout.");
    if (!confirm(parts.join("\n\n"))) return;

    setRunning(true);
    setResults(null);
    setProgress({});
    try {
      const res = await switchEnvironment(projectId, envId, options);
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
          <div className="eyebrow">Environment workflow</div>
          <h1>Switch environment</h1>
          <p>
            Dry-run preview updates as you change options. Then run the real
            switch.
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
            {!running && <Icon name="switch" size={16} />}
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
            <span className="muted"> — auto-stash before checkout</span>
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
            <span className="muted"> — only repos that were stashed</span>
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
            <span className="muted"> — git fetch --all --prune</span>
          </span>
        </label>
        {previewLoading && (
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Updating preview…
          </div>
        )}
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
                <th>Preview</th>
                <th>Progress / result</th>
              </tr>
            </thead>
            <tbody>
              {enabledRepos.map((repo) => {
                const st = statuses[repo.id];
                const target = branchMap[repo.id] ?? "";
                const prev = preview[repo.id];
                const prog = progress[repo.id];
                const result = results?.find((r) => r.repoId === repo.id);
                return (
                  <tr key={repo.id}>
                    <td>
                      <strong>{repo.name}</strong>
                    </td>
                    <td className="mono">
                      {st?.currentBranch ?? prev?.currentBranch ?? "—"}
                      {(st?.isDirty ?? prev?.isDirty) ? (
                        <span className="badge warn" style={{ marginLeft: 8 }}>
                          dirty
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">
                      {target || prev?.targetBranch || "— not set —"}
                    </td>
                    <td>
                      {prev ? (
                        <span
                          className={`badge ${previewBadgeClass(prev.action)}`}
                          title={prev.detail}
                        >
                          {prev.detail}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
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
