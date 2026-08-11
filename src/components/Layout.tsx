import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { getProject } from "../lib/api";

export function Layout() {
  const { projectId } = useParams();
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProjectName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await getProject(projectId);
        if (!cancelled) setProjectName(detail.project.name);
      } catch {
        if (!cancelled) setProjectName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Git Workspace</div>

        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            isActive ? "nav-link active" : "nav-link"
          }
          title={
            projectName ? `Projects (${projectName})` : "Projects"
          }
        >
          {projectName ? (
            <>
              Projects{" "}
              <span className="nav-project-name">({projectName})</span>
            </>
          ) : (
            "Projects"
          )}
        </NavLink>

        {projectId && (
          <>
            <NavLink
              to={`/projects/${projectId}`}
              end
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Repos
            </NavLink>
            <NavLink
              to={`/projects/${projectId}/environments`}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Environments
            </NavLink>
            <NavLink
              to={`/projects/${projectId}/switch`}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Switch environment
            </NavLink>
          </>
        )}
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
