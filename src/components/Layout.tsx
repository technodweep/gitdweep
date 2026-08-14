import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { getProject } from "../lib/api";
import { Icon, type IconName } from "./Icon";

function NavigationLink({
  to,
  label,
  icon,
  end,
}: {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        isActive ? "nav-link active" : "nav-link"
      }
    >
      <Icon name={icon} />
      <span>{label}</span>
      <span className="nav-active-mark" />
    </NavLink>
  );
}

export function Layout() {
  const { projectId } = useParams();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    localStorage.getItem("git-workspace.sidebar-collapsed") === "true",
  );

  const toggleSidebar = () => {
    setIsSidebarCollapsed((isCollapsed) => {
      const nextValue = !isCollapsed;
      localStorage.setItem("git-workspace.sidebar-collapsed", String(nextValue));
      return nextValue;
    });
  };

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
    <div
      className={isSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}
    >
      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="branch" size={21} />
            </span>
            <span className="brand-copy">
              <strong>Git Workspace</strong>
              <small>Developer console</small>
            </span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-controls="app-sidebar"
            aria-expanded={!isSidebarCollapsed}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon
              name={isSidebarCollapsed ? "sidebar-expand" : "sidebar-collapse"}
              size={18}
            />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="nav-section">Overview</div>
          <NavigationLink to="/" end label="Projects" icon="grid" />

          {projectId && (
            <>
              <div className="workspace-context" title={projectName ?? undefined}>
                <span className="workspace-context-icon">
                  <Icon name="folder" size={16} />
                </span>
                <span>
                  <small>Current workspace</small>
                  <strong>{projectName ?? "Loading…"}</strong>
                </span>
              </div>
              <div className="nav-section">Workspace</div>
              <NavigationLink
                to={`/projects/${projectId}`}
                end
                label="Repositories"
                icon="repos"
              />
              <NavigationLink
                to={`/projects/${projectId}/environments`}
                label="Environments"
                icon="layers"
              />
              <NavigationLink
                to={`/projects/${projectId}/switch`}
                label="Switch environment"
                icon="switch"
              />
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <span className="connection-dot" />
          <span>
            <strong>Local workspace</strong>
            <small>Your data stays on this device</small>
          </span>
        </div>
      </aside>
      <main className="main">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
