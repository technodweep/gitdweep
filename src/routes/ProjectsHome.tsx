import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createProject,
  deleteProject,
  listProjects,
  pickFolder,
  scanRepos,
} from "../lib/api";
import type { ProjectSummary, ScannedRepo } from "../lib/types";
import { Toast } from "../components/Toast";

export function ProjectsHome() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(
    null,
  );

  async function refresh() {
    setLoading(true);
    try {
      // When opened in a plain browser (not Tauri), invoke is unavailable.
      if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
        setProjects([]);
        setToast({
          msg: "Running outside Tauri — backend commands are unavailable. Use `npm run tauri dev`.",
          error: true,
        });
        return;
      }
      setProjects(await listProjects());
    } catch (e) {
      setToast({ msg: String(e), error: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete project “${name}”? This cannot be undone.`)) return;
    try {
      await deleteProject(id);
      await refresh();
    } catch (e) {
      setToast({ msg: String(e), error: true });
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>Multi-repo workspaces with environment branch presets.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Add project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : projects.length === 0 ? (
        <div className="card empty">
          <p>No projects yet.</p>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            Create your first project
          </button>
        </div>
      ) : (
        <div className="card-list">
          {projects.map((p) => (
            <div
              key={p.id}
              className="card project-card"
              onClick={() => navigate(`/projects/${p.id}`)}
            >
              <div>
                <strong>{p.name}</strong>
                <div className="muted mono">{p.rootPath ?? "No root path"}</div>
                <div className="muted" style={{ marginTop: "0.25rem" }}>
                  {p.repoCount} repo{p.repoCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  Open
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => void onDelete(p.id, p.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            navigate(`/projects/${id}`);
          }}
          onError={(msg) => setToast({ msg, error: true })}
        />
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

function CreateProjectModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedRepo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  async function chooseRoot() {
    const folder = await pickFolder("Select project root folder");
    if (!folder) return;
    setRootPath(folder);
    setBusy(true);
    try {
      const found = await scanRepos(folder, 5);
      setScanned(found);
      setSelected(new Set(found.map((r) => r.path)));
      if (!name.trim()) {
        const base = folder.split(/[/\\]/).filter(Boolean).pop() ?? "Project";
        setName(base);
      }
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function addManualRepo() {
    const folder = await pickFolder("Select a git repository");
    if (!folder) return;
    setScanned((prev) => {
      if (prev.some((r) => r.path === folder)) return prev;
      const repoName = folder.split(/[/\\]/).filter(Boolean).pop() ?? folder;
      return [...prev, { path: folder, name: repoName }];
    });
    setSelected((prev) => new Set(prev).add(folder));
  }

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) {
      onError("Project name is required");
      return;
    }
    setBusy(true);
    try {
      const detail = await createProject({
        name: name.trim(),
        rootPath,
        repoPaths: Array.from(selected),
      });
      onCreated(detail.project.id);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add project</h2>
        <div className="form-grid">
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My workspace"
            />
          </label>
          <div>
            <div className="actions">
              <button className="btn" onClick={() => void chooseRoot()} disabled={busy}>
                {rootPath ? "Change root & rescan" : "Pick root folder & scan"}
              </button>
              <button className="btn" onClick={() => void addManualRepo()} disabled={busy}>
                Add repo manually
              </button>
            </div>
            {rootPath && (
              <div className="muted mono" style={{ marginTop: "0.5rem" }}>
                {rootPath}
              </div>
            )}
          </div>
          {scanned.length > 0 && (
            <div>
              <div className="muted">
                Select repos to include ({selected.size}/{scanned.length})
              </div>
              <div className="scan-list">
                {scanned.map((r) => (
                  <label key={r.path} className="scan-item">
                    <input
                      type="checkbox"
                      checked={selected.has(r.path)}
                      onChange={() => toggle(r.path)}
                    />
                    <span>
                      <strong>{r.name}</strong>
                      <div className="muted mono">{r.path}</div>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? "Working…" : "Create project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
