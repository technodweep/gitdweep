import { useEffect, useRef } from "react";
import type { GitOperationLog } from "../lib/gitOperationLog";

export function GitCommandLog({ log, onClose, embedded = false }: {
  log: GitOperationLog;
  onClose: () => void;
  embedded?: boolean;
}) {
  const output = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && output.current) {
      output.current.scrollTop = output.current.scrollHeight;
    }
  }, [log.entries]);

  return (
    <section className={`git-command-log${embedded ? " embedded" : " docked"}`} aria-label="Git command log">
      <header className="git-command-log-header">
        <strong>{log.title} — command log</strong>
        <span className={`badge ${log.running ? "" : log.failed ? "err" : "ok"}`} role="status">
          {log.running ? "Running…" : log.failed ? "Finished with errors" : "Finished"}
        </span>
        <button className="btn" type="button" disabled={log.running} onClick={onClose}>
          Close log
        </button>
      </header>
      <div className="git-command-log-output mono" ref={output} role="log" aria-label="Git commands and output"
        tabIndex={0} onScroll={() => {
          const node = output.current;
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
        }}>
        {log.omitted > 0 && <div className="muted">{log.omitted} earlier log entries omitted.</div>}
        {log.entries.length === 0 && <div className="muted">Starting operation…</div>}
        {log.entries.map((entry, index) => (
          <div key={index} className={`git-command-log-entry ${entry.kind}`}>
            {entry.repoPath && (index === 0 || log.entries[index - 1].repoPath !== entry.repoPath) && (
              <div className="git-command-log-repo">{entry.repoPath}</div>
            )}
            <div>{entry.kind === "command" ? "$ " : ""}{entry.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
