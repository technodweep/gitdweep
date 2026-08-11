use crate::models::ScannedRepo;
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    "vendor",
    "__pycache__",
    ".venv",
    "venv",
];

/// Scan `root` for git repositories (directories containing `.git`).
/// Does not descend into found repos or known heavy directories.
pub fn scan_repos_efficient(root: &str, max_depth: usize) -> Result<Vec<ScannedRepo>, String> {
    let root_path = PathBuf::from(root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }

    let mut results = Vec::new();
    if is_git_repo(&root_path) {
        results.push(scanned(&root_path));
        return Ok(results);
    }

    fn walk(
        dir: &Path,
        depth: usize,
        max_depth: usize,
        results: &mut Vec<ScannedRepo>,
    ) -> Result<(), String> {
        if depth > max_depth {
            return Ok(());
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Ok(()),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            if is_git_repo(&path) {
                results.push(scanned(&path));
                continue; // do not descend into the repo
            }
            walk(&path, depth + 1, max_depth, results)?;
        }
        Ok(())
    }

    walk(&root_path, 1, max_depth, &mut results)?;
    results.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(results)
}

fn is_git_repo(path: &Path) -> bool {
    let git = path.join(".git");
    git.is_dir() || git.is_file()
}

fn scanned(path: &Path) -> ScannedRepo {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo")
        .to_string();
    ScannedRepo {
        path: path.to_string_lossy().to_string(),
        name,
    }
}
