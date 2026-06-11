// 数据库全部 CRUD 操作封装（rusqlite）
// 设计：使用 Mutex<Connection> 持有单例连接，所有命令通过 with_conn 访问
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::AppHandle;

use super::db_path::db_file_path;

// ============================================================
// 类型定义（与前端 types.ts 对齐）
// ============================================================

#[derive(Serialize, Debug, Clone)]
pub struct FileItem {
    pub id: i64,
    pub file_path: String,
    pub file_name: String,
    pub file_size: i64,
    pub file_mtime: i64,
    pub file_hash: String,
    pub tags: Vec<String>,
    pub tag_ids: Vec<i64>,
    pub is_directory: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct TagItem {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub group_id: Option<i64>,
    pub sort_order: i64,
}

#[derive(Serialize, Debug, Clone)]
pub struct TagGroup {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Deserialize, Debug)]
pub struct SortOrderItem {
    pub id: i64,
    pub sort_order: i64,
}

#[derive(Serialize, Debug, Clone)]
pub struct SyncResult {
    pub synced: usize,
    pub total: usize,
}

#[derive(Serialize, Debug, Clone)]
pub struct RemapResult {
    pub mapped: usize,
    pub total: usize,
}

#[derive(Serialize, Debug, Clone)]
pub struct BatchAddResult {
    pub added: usize,
    pub skipped: usize,
}

#[derive(Serialize, Debug, Clone)]
pub struct BatchRemoveResult {
    pub removed: usize,
}

// ============================================================
// 全局连接单例
// ============================================================

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// 初始化数据库连接、建表与列迁移
pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let path: PathBuf = db_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    eprintln!("[db] tags.db 路径：{}", path.display());
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            file_mtime INTEGER NOT NULL DEFAULT 0,
            file_hash TEXT NOT NULL,
            is_directory INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tag_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#808080',
            group_id INTEGER REFERENCES tag_groups(id),
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS file_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(file_id, tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_files_hash ON files(file_hash);
        "#,
    )
    .map_err(|e| e.to_string())?;

    run_migrations(&conn)?;
    DB.set(Mutex::new(conn)).map_err(|_| "DB 已初始化".to_string())?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let need = |table: &str, col: &str| -> bool {
        let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
            Ok(s) => s,
            Err(_) => return true,
        };
        let mut rows = match stmt.query([]) {
            Ok(r) => r,
            Err(_) => return true,
        };
        let mut found = false;
        while let Ok(Some(row)) = rows.next() {
            let name: String = row.get(1).unwrap_or_default();
            if name == col {
                found = true;
                break;
            }
        }
        !found
    };

    if need("files", "is_directory") {
        conn.execute("ALTER TABLE files ADD COLUMN is_directory INTEGER NOT NULL DEFAULT 0", [])
            .map_err(|e| e.to_string())?;
    }
    if need("tags", "group_id") {
        conn.execute("ALTER TABLE tags ADD COLUMN group_id INTEGER REFERENCES tag_groups(id)", [])
            .map_err(|e| e.to_string())?;
    }
    if need("tags", "sort_order") {
        conn.execute("ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0", [])
            .map_err(|e| e.to_string())?;
    }
    if need("tag_groups", "sort_order") {
        conn.execute("ALTER TABLE tag_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn with_conn<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&Connection) -> Result<R, String>,
{
    let guard = DB.get().ok_or("数据库未初始化")?.lock();
    f(&guard)
}

// ============================================================
// 工具函数
// ============================================================

fn parse_tags_csv(v: Option<String>) -> Vec<String> {
    v.filter(|s| !s.is_empty())
        .map(|s| s.split(',').map(|x| x.to_string()).collect())
        .unwrap_or_default()
}

fn parse_tag_ids_csv(v: Option<String>) -> Vec<i64> {
    v.filter(|s| !s.is_empty())
        .map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
        .unwrap_or_default()
}

fn row_to_file_item(row: &Row) -> Result<FileItem, rusqlite::Error> {
    let id: i64 = row.get(0)?;
    let file_path: String = row.get(1)?;
    let file_name: String = row.get(2)?;
    let file_size: i64 = row.get(3)?;
    let file_mtime: i64 = row.get(4)?;
    let file_hash: String = row.get(5)?;
    let is_dir: i64 = row.get(6)?;
    let tags_csv: Option<String> = row.get(7)?;
    let tag_ids_csv: Option<String> = row.get(8)?;
    Ok(FileItem {
        id,
        file_path,
        file_name,
        file_size,
        file_mtime,
        file_hash,
        tags: parse_tags_csv(tags_csv),
        tag_ids: parse_tag_ids_csv(tag_ids_csv),
        is_directory: is_dir != 0,
    })
}

const FILE_ITEM_SELECT: &str = "SELECT f.id, f.file_path, f.file_name, f.file_size, f.file_mtime, f.file_hash, f.is_directory, GROUP_CONCAT(t.name), GROUP_CONCAT(ft.tag_id) FROM files f LEFT JOIN file_tags ft ON f.id = ft.file_id LEFT JOIN tags t ON ft.tag_id = t.id";

// ============================================================
// 文件查询
// ============================================================

#[tauri::command]
pub fn get_file_tags_by_paths(paths: Vec<String>) -> Result<Vec<FileItem>, String> {
    with_conn(|conn| {
        if paths.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = std::iter::repeat("?").take(paths.len()).collect::<Vec<_>>().join(",");
        let sql = format!("{} WHERE f.file_path IN ({}) GROUP BY f.id", FILE_ITEM_SELECT, placeholders);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params_vec: Vec<&dyn rusqlite::ToSql> = paths.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(&params_vec[..], row_to_file_item)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn get_scanned_files(folder_path: String) -> Result<Vec<FileItem>, String> {
    with_conn(|conn| {
        let like = format!("{}%", folder_path);
        let sql = format!("{} WHERE f.file_path LIKE ? GROUP BY f.id", FILE_ITEM_SELECT);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&like], row_to_file_item)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn search_by_tag(tag_id: i64) -> Result<Vec<FileItem>, String> {
    with_conn(|conn| {
        let sql = format!(
            "{} JOIN file_tags ft2 ON f.id = ft2.file_id WHERE ft2.tag_id = ? GROUP BY f.id",
            FILE_ITEM_SELECT
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([tag_id], row_to_file_item)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

// ============================================================
// 标签组
// ============================================================

#[tauri::command]
pub fn get_tag_groups() -> Result<Vec<TagGroup>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, sort_order FROM tag_groups ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TagGroup {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    sort_order: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn create_tag_group(name: String) -> Result<i64, String> {
    with_conn(|conn| {
        let max_sort: i64 = conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) FROM tag_groups", [], |r| r.get(0))
            .unwrap_or(-1);
        conn.execute(
            "INSERT INTO tag_groups (name, sort_order) VALUES (?1, ?2)",
            params![name, max_sort + 1],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    })
}

#[tauri::command]
pub fn update_tag_group(group_id: i64, name: String) -> Result<bool, String> {
    with_conn(|conn| {
        conn.execute(
            "UPDATE tag_groups SET name = ?1 WHERE id = ?2",
            params![name, group_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn delete_tag_group(group_id: i64) -> Result<bool, String> {
    with_conn(|conn| {
        conn.execute("UPDATE tags SET group_id = NULL WHERE group_id = ?1", params![group_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM tag_groups WHERE id = ?1", params![group_id])
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn update_tag_group_order(orders: Vec<SortOrderItem>) -> Result<bool, String> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for o in orders {
            tx.execute(
                "UPDATE tag_groups SET sort_order = ?1 WHERE id = ?2",
                params![o.sort_order, o.id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(true)
    })
}

// ============================================================
// 标签
// ============================================================

#[tauri::command]
pub fn get_tags() -> Result<Vec<TagItem>, String> {
    with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, name, color, group_id, sort_order FROM tags ORDER BY sort_order")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TagItem {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    group_id: row.get(3)?,
                    sort_order: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn create_tag(name: String, color: String, group_id: Option<i64>) -> Result<i64, String> {
    with_conn(|conn| {
        let max_sort: i64 = match group_id {
            None => conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) FROM tags WHERE group_id IS NULL",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(-1),
            Some(gid) => conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) FROM tags WHERE group_id = ?1",
                    params![gid],
                    |r| r.get(0),
                )
                .unwrap_or(-1),
        };
        conn.execute(
            "INSERT INTO tags (name, color, group_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![name, color, group_id, max_sort + 1],
        )
        .map_err(|e| e.to_string())?;
        Ok(conn.last_insert_rowid())
    })
}

#[tauri::command]
pub fn delete_tag(tag_id: i64) -> Result<bool, String> {
    with_conn(|conn| {
        conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn update_tag_order(orders: Vec<SortOrderItem>) -> Result<bool, String> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for o in orders {
            tx.execute(
                "UPDATE tags SET sort_order = ?1 WHERE id = ?2",
                params![o.sort_order, o.id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(true)
    })
}

// ============================================================
// 文件-标签关联
// ============================================================

fn ensure_file_record(
    conn: &Connection,
    file_id: i64,
    file_path: &str,
    file_name: &str,
    is_directory: bool,
) -> Result<i64, String> {
    // file_id >= 0 直接使用
    if file_id >= 0 {
        if is_directory {
            let existing_hash: Option<String> = conn
                .query_row(
                    "SELECT file_hash FROM files WHERE id = ?1",
                    params![file_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if existing_hash.as_deref().map(|s| s.is_empty()).unwrap_or(true) {
                let uuid = crate::commands::folder_tag::create_folder_tag_file_inner(file_path)?;
                conn.execute(
                    "UPDATE files SET file_hash = ?1 WHERE id = ?2",
                    params![uuid, file_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        return Ok(file_id);
    }

    // 先查现有记录
    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, file_hash FROM files WHERE file_path = ?1",
            params![file_path],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((existing_id, existing_hash)) = existing {
        if is_directory && existing_hash.is_empty() {
            let uuid = crate::commands::folder_tag::create_folder_tag_file_inner(file_path)?;
            conn.execute(
                "UPDATE files SET file_hash = ?1 WHERE id = ?2",
                params![uuid, existing_id],
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(existing_id);
    }

    // 全新入库
    if is_directory {
        let uuid = crate::commands::folder_tag::create_folder_tag_file_inner(file_path)?;
        conn.execute(
            "INSERT INTO files (file_path, file_name, file_size, file_mtime, file_hash, is_directory) VALUES (?1, ?2, 0, 0, ?3, 1)",
            params![file_path, file_name, uuid],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let (size, mtime, hash) = match crate::commands::fs::stat_path_inner(file_path)
            .ok()
            .zip(crate::commands::hash::compute_file_hash_inner(file_path).ok())
        {
            Some((stat, hash)) => (stat.size as i64, stat.mtime, hash),
            None => (0, 0, String::new()),
        };
        conn.execute(
            "INSERT INTO files (file_path, file_name, file_size, file_mtime, file_hash, is_directory) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
            params![file_path, file_name, size, mtime, hash],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn add_file_tag(
    file_id: i64,
    tag_id: i64,
    file_path: String,
    file_name: String,
    is_directory: bool,
) -> Result<bool, String> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let actual_id = ensure_file_record(&tx, file_id, &file_path, &file_name, is_directory)?;
        // UNIQUE 约束保证幂等
        tx.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
            params![actual_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn remove_file_tag(file_id: i64, tag_id: i64) -> Result<bool, String> {
    with_conn(|conn| {
        conn.execute(
            "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
            params![file_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn delete_file(file_id: i64) -> Result<bool, String> {
    with_conn(|conn| {
        conn.execute("DELETE FROM files WHERE id = ?1", params![file_id])
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

// ============================================================
// 批量打标签
// ============================================================

fn basename(path: &str) -> String {
    path.rsplit(|c| c == '\\' || c == '/')
        .next()
        .unwrap_or(path)
        .to_string()
}

#[tauri::command]
pub fn batch_add_tags(file_paths: Vec<String>, tag_ids: Vec<i64>) -> Result<BatchAddResult, String> {
    with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut added = 0usize;
        let mut skipped = 0usize;
        for path in &file_paths {
            let name = basename(path);
            let file_id = ensure_file_record(&tx, -1, path, &name, false)?;
            for &tag_id in &tag_ids {
                let exists: bool = tx
                    .query_row(
                        "SELECT 1 FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
                        params![file_id, tag_id],
                        |_| Ok(true),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .unwrap_or(false);
                if exists {
                    skipped += 1;
                } else {
                    tx.execute(
                        "INSERT INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                        params![file_id, tag_id],
                    )
                    .map_err(|e| e.to_string())?;
                    added += 1;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BatchAddResult { added, skipped })
    })
}

#[tauri::command]
pub fn batch_remove_tags(file_paths: Vec<String>, tag_ids: Vec<i64>) -> Result<BatchRemoveResult, String> {
    with_conn(|conn| {
        let mut removed = 0usize;
        for path in &file_paths {
            let file_id: Option<i64> = conn
                .query_row(
                    "SELECT id FROM files WHERE file_path = ?1",
                    params![path],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(fid) = file_id {
                for &tid in &tag_ids {
                    removed += conn
                        .execute(
                            "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
                            params![fid, tid],
                        )
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(BatchRemoveResult { removed })
    })
}

// ============================================================
// 同步与重映射
// ============================================================

#[tauri::command]
pub fn sync_folder(folder_path: String) -> Result<SyncResult, String> {
    use crate::commands::fs::ScanResult;

    let scan: ScanResult = crate::commands::fs::scan_folder_inner(&folder_path)?;
    let file_entries: Vec<_> = scan.files.iter().filter(|f| f.is_directory == 0).collect();
    let folder_entries: Vec<_> = scan.folders.iter().collect();
    let total = file_entries.len() + folder_entries.len();

    let mut hash_map: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let mut remapped = 0usize;

    {
        let conn_guard = DB.get().ok_or("数据库未初始化")?.lock();
        // 取出已有 hash 映射
        let mut stmt = conn_guard
            .prepare("SELECT file_hash, id FROM files WHERE file_hash != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (h, id) = r.map_err(|e| e.to_string())?;
            hash_map.entry(h).or_insert(id);
        }
    }

    let mut tag_copies: Vec<(i64, i64)> = Vec::new(); // (new_id, tag_id)

    // ---- 1. 处理文件：按 hash 匹配并复制标签 ----
    for entry in &file_entries {
        let hash = match crate::commands::hash::compute_file_hash_inner(&entry.path) {
            Ok(h) => h,
            Err(_) => continue,
        };
        let Some(&existing_id) = hash_map.get(&hash) else {
            continue;
        };

        let dup: bool = with_conn(|conn| {
            conn.query_row(
                "SELECT 1 FROM files WHERE file_path = ?1",
                params![&entry.path],
                |_| Ok(true),
            )
            .optional()
            .map(|o| o.unwrap_or(false))
            .map_err(|e| e.to_string())
        })?;
        if dup {
            continue;
        }

        let stat = crate::commands::fs::stat_path_inner(&entry.path).ok();
        let (size, mtime) = stat.map(|s| (s.size as i64, s.mtime)).unwrap_or((0, 0));

        let new_id: i64 = with_conn(|conn| {
            conn.execute(
                "INSERT INTO files (file_path, file_name, file_size, file_mtime, file_hash, is_directory) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![&entry.path, &entry.name, size, mtime, &hash],
            )
            .map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        })?;

        let tags: Vec<i64> = with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT tag_id FROM file_tags WHERE file_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([existing_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            let mut v = Vec::new();
            for r in rows {
                v.push(r.map_err(|e| e.to_string())?);
            }
            Ok(v)
        })?;

        for t in tags {
            tag_copies.push((new_id, t));
        }
    }

    // ---- 2. 处理文件夹：读 uuid.tag 重映射 ----
    for folder in &folder_entries {
        remapped += remap_one_folder(&folder.path)?;
    }

    // ---- 3. 批量写入文件标签复制 ----
    if !tag_copies.is_empty() {
        with_conn(|conn| {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            for (fid, tid) in &tag_copies {
                tx.execute(
                    "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                    params![fid, tid],
                )
                .map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })?;
    }

    let synced = tag_copies.len() + remapped;
    Ok(SyncResult { synced, total })
}

/// 重新映射单个文件夹：读 uuid.tag，找历史同 uuid 记录并复制标签。
/// 返回本次新增的标签关联数。
fn remap_one_folder(folder_path: &str) -> Result<usize, String> {
    let current_uuid = crate::commands::folder_tag::read_folder_tag_inner(folder_path)?;
    let name = basename(folder_path);

    if current_uuid.is_none() {
        // 没有 uuid.tag：跳过（用户要求「如果有则尝试重新映射」）
        return Ok(0);
    }

    with_conn(|conn| {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let uuid = current_uuid.unwrap();

        // 确保新路径在 files 表里
        let new_file_id: i64 = tx
            .query_row(
                "SELECT id FROM files WHERE file_path = ?1",
                params![folder_path],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_else(|| {
                tx.execute(
                    "INSERT INTO files (file_path, file_name, file_size, file_mtime, file_hash, is_directory) VALUES (?1, ?2, 0, 0, ?3, 1)",
                    params![folder_path, &name, &uuid],
                )
                .map_err(|e| e.to_string())
                .ok();
                tx.last_insert_rowid()
            });

        // 找历史上同 uuid 的其它文件夹记录，复制其标签
        let source_id: Option<i64> = tx
            .query_row(
                "SELECT id FROM files WHERE file_hash = ?1 AND file_path != ?2 AND is_directory = 1",
                params![&uuid, folder_path],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let mut mapped = 0usize;
        if let Some(src_id) = source_id {
            let mut stmt = tx
                .prepare("SELECT tag_id FROM file_tags WHERE file_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([src_id], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            for r in rows {
                let tid = r.map_err(|e| e.to_string())?;
                let exists: bool = tx
                    .query_row(
                        "SELECT 1 FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
                        params![new_file_id, tid],
                        |_| Ok(true),
                    )
                    .optional()
                    .map(|o| o.unwrap_or(false))
                    .map_err(|e| e.to_string())?;
                if !exists {
                    tx.execute(
                        "INSERT INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
                        params![new_file_id, tid],
                    )
                    .map_err(|e| e.to_string())?;
                    mapped += 1;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(mapped)
    })
}

#[tauri::command]
pub fn remap_folder_tags(folder_path: String) -> Result<RemapResult, String> {
    let mapped = remap_one_folder(&folder_path)?;
    Ok(RemapResult { mapped, total: mapped })
}