import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createEnvironment,
  deleteEnvironment,
  setEnvironmentBranch,
  updateEnvironment,
} from "../lib/api";
import type { BranchInfo, Environment, ProjectDetail } from "../lib/types";
import {
  cacheEnvironmentBranch,
  loadEnvironmentBranchMap,
  loadWorkspace,
  peekEnvironmentBranchMap,
  peekWorkspace,
} from "../lib/workspaceCache";
import { Toast } from "../components/Toast";
import { Icon } from "../components/Icon";
import { PageLoading } from "../components/PageLoading";

export function EnvironmentEditor() {
  const { projectId = "" } = useParams();
  const initialWorkspace = peekWorkspace(projectId);
  const initialEnvironmentId =
    initialWorkspace?.environments.find((environment) => environment.isDefault)
      ?.id ??
    initialWorkspace?.environments[0]?.id ??
    null;
  const initialBranchMap = peekEnvironmentBranchMap(initialEnvironmentId);
  const [detail, setDetail] = useState<ProjectDetail | null>(
    initialWorkspace?.detail ?? null,
  );
  const [envs, setEnvs] = useState<Environment[]>(
    initialWorkspace?.environments ?? [],
  );
  const [activeEnvId, setActiveEnvId] = useState<string | null>(
    initialEnvironmentId,
  );
  const [branchMap, setBranchMap] = useState<Record<string, string>>(
    initialBranchMap ?? {},
  );
  const [repoBranches, setRepoBranches] = useState<
    Record<string, BranchInfo[]>
  >(initialWorkspace?.branches ?? {});
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(!initialWorkspace);
  const [branchMapEnvId, setBranchMapEnvId] = useState<string | null>(
    initialBranchMap ? initialEnvironmentId : null,
  );
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  const refresh = useCallback(
    async (force = true) => {
      try {
        const workspace = await loadWorkspace(projectId, force);
        const d = workspace.detail;
        const e = workspace.environments;
        setDetail(d);
        setEnvs(e);
        setRepoBranches(workspace.branches);
        setActiveEnvId((prev) => {
          if (prev && e.some((x) => x.id === prev)) return prev;
          return e.find((x) => x.isDefault)?.id ?? e[0]?.id ?? null;
        });
      } catch (err) {
        setToast({ msg: String(err), error: true });
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useLayoutEffect(() => {
    if (!activeEnvId) {
      setBranchMap({});
      setBranchMapEnvId(null);
      return;
    }
    const cached = peekEnvironmentBranchMap(activeEnvId);
    if (cached) {
      setBranchMap(cached);
      setBranchMapEnvId(activeEnvId);
      return;
    }
    setBranchMapEnvId(null);
    let cancelled = false;
    void (async () => {
      try {
        const map = await loadEnvironmentBranchMap(activeEnvId);
        if (!cancelled) {
          setBranchMap(map);
          setBranchMapEnvId(activeEnvId);
        }
      } catch (err) {
        if (!cancelled) {
          setBranchMap({});
          setBranchMapEnvId(activeEnvId);
          setToast({ msg: String(err), error: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEnvId]);

  async function onCreate() {
    if (!newName.trim()) return;
    try {
      const env = await createEnvironment(projectId, newName.trim());
      setNewName("");
      await refresh();
      setActiveEnvId(env.id);
      setToast({ msg: `Created environment “${env.name}”` });
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onDelete(env: Environment) {
    if (!confirm(`Delete environment “${env.name}”?`)) return;
    try {
      await deleteEnvironment(env.id);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onSetDefault(env: Environment) {
    try {
      await updateEnvironment(env.id, undefined, true);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function onBranchChange(repoId: string, branch: string) {
    if (!activeEnvId) return;
    try {
      await setEnvironmentBranch(activeEnvId, repoId, branch);
      setBranchMap((prev) => ({ ...prev, [repoId]: branch }));
      cacheEnvironmentBranch(activeEnvId, repoId, branch);
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function setAllTo(branch: string) {
    if (!activeEnvId || !detail) return;
    try {
      for (const repo of detail.repos) {
        await setEnvironmentBranch(activeEnvId, repo.id, branch);
      }
      const map = await loadEnvironmentBranchMap(activeEnvId, true);
      setBranchMap(map);
      setToast({ msg: `Set all repos to “${branch}”` });
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  async function copyFrom(sourceEnvId: string) {
    if (!activeEnvId || sourceEnvId === activeEnvId) return;
    try {
      const sourceMap = await loadEnvironmentBranchMap(sourceEnvId);
      for (const [repoId, branch] of Object.entries(sourceMap)) {
        await setEnvironmentBranch(activeEnvId, repoId, branch);
      }
      const refreshed = await loadEnvironmentBranchMap(activeEnvId, true);
      setBranchMap(refreshed);
      setToast({ msg: "Copied branch map from environment" });
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  const active = envs.find((e) => e.id === activeEnvId) ?? null;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Branch presets</div>
          <h1>Environments</h1>
          <p>
            Define per-repo default branches for {detail?.project.name ?? "…"}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="actions">
          <input
            type="text"
            placeholder="New environment name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ minWidth: 200 }}
          />
          <button className="btn btn-primary" onClick={() => void onCreate()}>
            <Icon name="plus" size={16} />
            Create
          </button>
        </div>
      </div>

      {loading || (activeEnvId !== null && branchMapEnvId !== activeEnvId) ? (
        <PageLoading label="Loading environments…" />
      ) : envs.length === 0 ? (
        <div className="empty">No environments yet.</div>
      ) : (
        <>
          <div className="tabs">
            {envs.map((env) => (
              <button
                key={env.id}
                className={`tab${env.id === activeEnvId ? " active" : ""}`}
                onClick={() => setActiveEnvId(env.id)}
              >
                {env.name}
                {env.isDefault ? " ★" : ""}
              </button>
            ))}
          </div>

          {active && detail && (
            <div className="card">
              <div className="page-header" style={{ marginBottom: "0.75rem" }}>
                <div>
                  <h1 style={{ fontSize: "1.1rem" }}>{active.name}</h1>
                  <p>
                    {active.isDefault
                      ? "Default environment"
                      : "Not the default environment"}
                  </p>
                </div>
                <div className="actions">
                  {!active.isDefault && (
                    <button
                      className="btn"
                      onClick={() => void onSetDefault(active)}
                    >
                      Make default
                    </button>
                  )}
                  <button className="btn" onClick={() => void setAllTo("main")}>
                    Set all to main
                  </button>
                  <button
                    className="btn"
                    onClick={() => void setAllTo("develop")}
                  >
                    Set all to develop
                  </button>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v) void copyFrom(v);
                    }}
                  >
                    <option value="">Copy from…</option>
                    {envs
                      .filter((e) => e.id !== active.id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="btn btn-danger"
                    onClick={() => void onDelete(active)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Repo</th>
                      <th>Target branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.repos.map((repo) => (
                      <tr key={repo.id}>
                        <td>
                          <strong>{repo.name}</strong>
                          <div className="muted mono">{repo.path}</div>
                        </td>
                        <td>
                          <div className="actions">
                            <select
                              value={branchMap[repo.id] ?? ""}
                              onChange={(e) =>
                                void onBranchChange(repo.id, e.target.value)
                              }
                            >
                              <option value="">— not set —</option>
                              <optgroup label="Local">
                                {(repoBranches[repo.id] ?? [])
                                  .filter((b) => b.kind === "local")
                                  .map((b) => (
                                    <option key={b.name} value={b.name}>
                                      {b.name}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Remote">
                                {(repoBranches[repo.id] ?? [])
                                  .filter((b) => b.kind === "remote")
                                  .map((b) => (
                                    <option key={b.name} value={b.shortName}>
                                      {b.name}
                                    </option>
                                  ))}
                              </optgroup>
                              {branchMap[repo.id] &&
                                !(repoBranches[repo.id] ?? []).some(
                                  (b) =>
                                    b.name === branchMap[repo.id] ||
                                    b.shortName === branchMap[repo.id],
                                ) && (
                                  <option value={branchMap[repo.id]}>
                                    {branchMap[repo.id]}
                                  </option>
                                )}
                            </select>
                            <input
                              type="text"
                              placeholder="or type branch"
                              defaultValue=""
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v) {
                                  void onBranchChange(repo.id, v);
                                  e.target.value = "";
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const v = (
                                    e.target as HTMLInputElement
                                  ).value.trim();
                                  if (v) {
                                    void onBranchChange(repo.id, v);
                                    (e.target as HTMLInputElement).value = "";
                                  }
                                }
                              }}
                              style={{ minWidth: 140 }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
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
