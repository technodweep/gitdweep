import { Component, type ErrorInfo, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProjectsHome } from "./routes/ProjectsHome";
import { ProjectDetail } from "./routes/ProjectDetail";
import { EnvironmentEditor } from "./routes/EnvironmentEditor";
import { EnvironmentSwitcher } from "./routes/EnvironmentSwitcher";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crash", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "1.5rem", color: "#f07178" }}>
          <h1 style={{ color: "#e8ecf4" }}>Something went wrong</h1>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
            {"\n"}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ProjectsHome />} />
            <Route path="projects/:projectId" element={<ProjectDetail />} />
            <Route
              path="projects/:projectId/environments"
              element={<EnvironmentEditor />}
            />
            <Route
              path="projects/:projectId/switch"
              element={<EnvironmentSwitcher />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
