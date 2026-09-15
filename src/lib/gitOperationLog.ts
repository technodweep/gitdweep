import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface GitLogEntry {
  repoPath: string;
  kind: "command" | "stdout" | "stderr" | "exit" | "error" | "summary";
  text: string;
}

export interface GitOperationLog {
  title: string;
  running: boolean;
  failed: boolean;
  entries: GitLogEntry[];
  omitted: number;
}

const MAX_ENTRIES = 2000;

export function useGitOperationLog() {
  const [log, setLog] = useState<GitOperationLog | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const runLogged = useCallback(async <T,>(
    title: string,
    operation: (channel: Channel<GitLogEntry>) => Promise<T>,
    summarize: (result: T) => { text: string; failed?: boolean },
    append = false,
  ): Promise<T> => {
    const id = ++generation.current;
    setLog((previous) => ({
      title, running: true, failed: false,
      entries: append ? previous?.entries ?? [] : [],
      omitted: append ? previous?.omitted ?? 0 : 0,
    }));
    const add = (entry: GitLogEntry) => {
      if (id !== generation.current) return;
      setLog((previous) => {
        if (!previous) return previous;
        const entries = [...previous.entries, entry];
        const excess = Math.max(0, entries.length - MAX_ENTRIES);
        return { ...previous, entries: entries.slice(excess), omitted: previous.omitted + excess };
      });
    };
    const channel = new Channel<GitLogEntry>();
    channel.onmessage = add;
    try {
      const result = await operation(channel);
      const summary = summarize(result);
      add({ repoPath: "", kind: summary.failed ? "error" : "summary", text: summary.text });
      if (id === generation.current) {
        setLog((previous) => previous && { ...previous, running: false, failed: !!summary.failed });
      }
      return result;
    } catch (error) {
      add({ repoPath: "", kind: "error", text: String(error) });
      if (id === generation.current) {
        setLog((previous) => previous && { ...previous, running: false, failed: true });
      }
      throw error;
    }
  }, []);

  const closeLog = useCallback(() => {
    setLog((previous) => previous?.running ? previous : null);
  }, []);

  return { log, runLogged, closeLog };
}
