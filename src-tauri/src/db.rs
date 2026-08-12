use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- Same filesystem path may appear in multiple projects.
            -- Uniqueness is per project only: UNIQUE(project_id, path).
            CREATE TABLE IF NOT EXISTS repos (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                UNIQUE(project_id, path)
            );

            CREATE TABLE IF NOT EXISTS environments (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0,
                UNIQUE(project_id, name)
            );

            CREATE TABLE IF NOT EXISTS environment_branches (
                environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
                repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
                branch TEXT NOT NULL,
                PRIMARY KEY (environment_id, repo_id)
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| e.to_string())?;

        // Upgrade older DBs that enforced global UNIQUE on repos.path
        Self::migrate_repos_allow_shared_paths(&conn)?;
        Ok(())
    }

    /// Recreate `repos` if it still has a global UNIQUE on `path`.
    fn migrate_repos_allow_shared_paths(conn: &Connection) -> Result<(), String> {
        let version: Option<String> = conn
            .query_row(
                "SELECT value FROM schema_meta WHERE key = 'repos_shared_paths'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if version.as_deref() == Some("1") {
            return Ok(());
        }

        let create_sql: Option<String> = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'repos'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let needs_rebuild = match create_sql {
            None => false,
            Some(sql) => {
                let lower = sql.to_lowercase();
                // Old schema: "path TEXT NOT NULL UNIQUE" without project-scoped unique
                lower.contains("path text not null unique")
                    || (lower.contains("path text not null")
                        && !lower.contains("unique(project_id, path)"))
            }
        };

        if needs_rebuild {
            // Step-by-step (avoid nested-transaction issues with execute_batch + BEGIN)
            conn.execute_batch("PRAGMA foreign_keys = OFF;")
                .map_err(|e| format!("migrate repos: {e}"))?;
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS repos_new (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    name TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    UNIQUE(project_id, path)
                );
                "#,
            )
            .map_err(|e| format!("migrate repos create: {e}"))?;
            // Clear temp table if a previous migration left it around
            let _ = conn.execute("DELETE FROM repos_new", []);
            conn.execute(
                r#"
                INSERT INTO repos_new (id, project_id, path, name, enabled, created_at)
                    SELECT id, project_id, path, name, enabled, created_at FROM repos
                "#,
                [],
            )
            .map_err(|e| format!("migrate repos copy: {e}"))?;
            conn.execute("DROP TABLE repos", [])
                .map_err(|e| format!("migrate repos drop: {e}"))?;
            conn.execute("ALTER TABLE repos_new RENAME TO repos", [])
                .map_err(|e| format!("migrate repos rename: {e}"))?;
            conn.execute_batch("PRAGMA foreign_keys = ON;")
                .map_err(|e| format!("migrate repos fk on: {e}"))?;
        }

        conn.execute(
            r#"
            INSERT INTO schema_meta (key, value) VALUES ('repos_shared_paths', '1')
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT p.id, p.name, p.root_path, p.created_at, p.updated_at,
                       (SELECT COUNT(*) FROM repos r WHERE r.project_id = p.id) as repo_count
                FROM projects p
                ORDER BY p.updated_at DESC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ProjectSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    root_path: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    repo_count: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_project(&self, id: &str) -> Result<ProjectDetail, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let project = conn
            .query_row(
                "SELECT id, name, root_path, created_at, updated_at FROM projects WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(|_| format!("Project not found: {id}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, path, name, enabled, created_at FROM repos WHERE project_id = ?1 ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let repos = stmt
            .query_map(params![id], |row| {
                Ok(Repo {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    path: row.get(2)?,
                    name: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(ProjectDetail { project, repos })
    }

    pub fn create_project(
        &self,
        name: &str,
        root_path: Option<&str>,
        repo_paths: &[String],
    ) -> Result<ProjectDetail, String> {
        let now = chrono::Utc::now().timestamp();
        let project_id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![project_id, name, root_path, now, now],
        )
        .map_err(|e| e.to_string())?;

        for path in repo_paths {
            let repo_name = PathBuf::from(path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(path)
                .to_string();
            let repo_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO repos (id, project_id, path, name, enabled, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![repo_id, project_id, path, repo_name, now],
            )
            .map_err(|e| {
                if e.to_string().contains("UNIQUE") {
                    format!("Repo already in this project: {path}")
                } else {
                    e.to_string()
                }
            })?;
        }

        // Seed default environments
        for (idx, env_name) in ["development", "staging"].iter().enumerate() {
            let env_id = Uuid::new_v4().to_string();
            let is_default = if idx == 0 { 1 } else { 0 };
            conn.execute(
                "INSERT INTO environments (id, project_id, name, is_default) VALUES (?1, ?2, ?3, ?4)",
                params![env_id, project_id, env_name, is_default],
            )
            .map_err(|e| e.to_string())?;
        }

        drop(conn);
        self.get_project(&project_id)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Project not found: {id}"));
        }
        Ok(())
    }

    pub fn touch_project(&self, id: &str) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_repo(&self, project_id: &str, path: &str) -> Result<Repo, String> {
        let now = chrono::Utc::now().timestamp();
        let repo_id = Uuid::new_v4().to_string();
        let name = PathBuf::from(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Ensure project exists
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err(format!("Project not found: {project_id}"));
        }

        conn.execute(
            "INSERT INTO repos (id, project_id, path, name, enabled, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params![repo_id, project_id, path, name, now],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                format!("Repo already in this project: {path}")
            } else {
                e.to_string()
            }
        })?;
        conn.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now, project_id],
        )
        .map_err(|e| e.to_string())?;

        Ok(Repo {
            id: repo_id,
            project_id: project_id.to_string(),
            path: path.to_string(),
            name,
            enabled: true,
            created_at: now,
        })
    }

    pub fn remove_repo(&self, repo_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM repos WHERE id = ?1", params![repo_id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Repo not found: {repo_id}"));
        }
        Ok(())
    }

    pub fn set_repo_enabled(&self, repo_id: &str, enabled: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute(
                "UPDATE repos SET enabled = ?1 WHERE id = ?2",
                params![if enabled { 1 } else { 0 }, repo_id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Repo not found: {repo_id}"));
        }
        Ok(())
    }

    pub fn get_repo(&self, repo_id: &str) -> Result<Repo, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, project_id, path, name, enabled, created_at FROM repos WHERE id = ?1",
            params![repo_id],
            |row| {
                Ok(Repo {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    path: row.get(2)?,
                    name: row.get(3)?,
                    enabled: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                })
            },
        )
        .map_err(|_| format!("Repo not found: {repo_id}"))
    }

    pub fn list_environments(&self, project_id: &str) -> Result<Vec<Environment>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, is_default FROM environments WHERE project_id = ?1 ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |row| {
                Ok(Environment {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    name: row.get(2)?,
                    is_default: row.get::<_, i64>(3)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_environment(
        &self,
        project_id: &str,
        name: &str,
        is_default: bool,
    ) -> Result<Environment, String> {
        let env_id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if is_default {
            conn.execute(
                "UPDATE environments SET is_default = 0 WHERE project_id = ?1",
                params![project_id],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "INSERT INTO environments (id, project_id, name, is_default) VALUES (?1, ?2, ?3, ?4)",
            params![env_id, project_id, name, if is_default { 1 } else { 0 }],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                format!("Environment already exists: {name}")
            } else {
                e.to_string()
            }
        })?;
        Ok(Environment {
            id: env_id,
            project_id: project_id.to_string(),
            name: name.to_string(),
            is_default,
        })
    }

    pub fn update_environment(
        &self,
        env_id: &str,
        name: Option<&str>,
        is_default: Option<bool>,
    ) -> Result<Environment, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut env = conn
            .query_row(
                "SELECT id, project_id, name, is_default FROM environments WHERE id = ?1",
                params![env_id],
                |row| {
                    Ok(Environment {
                        id: row.get(0)?,
                        project_id: row.get(1)?,
                        name: row.get(2)?,
                        is_default: row.get::<_, i64>(3)? != 0,
                    })
                },
            )
            .map_err(|_| format!("Environment not found: {env_id}"))?;

        if let Some(n) = name {
            conn.execute(
                "UPDATE environments SET name = ?1 WHERE id = ?2",
                params![n, env_id],
            )
            .map_err(|e| e.to_string())?;
            env.name = n.to_string();
        }
        if let Some(d) = is_default {
            if d {
                conn.execute(
                    "UPDATE environments SET is_default = 0 WHERE project_id = ?1",
                    params![env.project_id],
                )
                .map_err(|e| e.to_string())?;
            }
            conn.execute(
                "UPDATE environments SET is_default = ?1 WHERE id = ?2",
                params![if d { 1 } else { 0 }, env_id],
            )
            .map_err(|e| e.to_string())?;
            env.is_default = d;
        }
        Ok(env)
    }

    pub fn delete_environment(&self, env_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let n = conn
            .execute("DELETE FROM environments WHERE id = ?1", params![env_id])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Environment not found: {env_id}"));
        }
        Ok(())
    }

    pub fn get_environment_map(
        &self,
        env_id: &str,
    ) -> Result<Vec<EnvironmentBranch>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT environment_id, repo_id, branch FROM environment_branches WHERE environment_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![env_id], |row| {
                Ok(EnvironmentBranch {
                    environment_id: row.get(0)?,
                    repo_id: row.get(1)?,
                    branch: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn set_environment_branch(
        &self,
        env_id: &str,
        repo_id: &str,
        branch: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if branch.trim().is_empty() {
            conn.execute(
                "DELETE FROM environment_branches WHERE environment_id = ?1 AND repo_id = ?2",
                params![env_id, repo_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                r#"
                INSERT INTO environment_branches (environment_id, repo_id, branch)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(environment_id, repo_id) DO UPDATE SET branch = excluded.branch
                "#,
                params![env_id, repo_id, branch.trim()],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            INSERT INTO app_settings (key, value) VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}
