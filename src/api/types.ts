// 共享类型定义，对应原 Electron IPC handler 的入参/出参
// 字段名采用 snake_case 与 Rust 序列化输出一致

export interface FileItem {
  id: number;
  file_path: string;
  file_name: string;
  file_size: number;
  file_mtime: number;
  file_hash: string;
  tags: string[];
  tag_ids: number[];
  is_directory?: boolean;
}

export interface ScanFileItem {
  path: string;
  name: string;
  is_directory: 0 | 1;
}

export interface ScanFolderItem {
  name: string;
  path: string;
}

export interface ScanResult {
  files: ScanFileItem[];
  folders: ScanFolderItem[];
  total: number;
}

export interface TagItem {
  id: number;
  name: string;
  color: string;
  group_id: number | null;
  sort_order: number;
}

export interface TagGroup {
  id: number;
  name: string;
  sort_order: number;
}

export interface DriveItem {
  name: string;
  label: string;
  size: number;
  free: number;
  type: number;
}

export interface FileStat {
  size: number;
  mtime: number;
  is_directory: boolean;
}

export interface SortOrderItem {
  id: number;
  sort_order: number;
}

export interface SyncResult {
  synced: number;
  total: number;
}

export interface RemapResult {
  mapped: number;
  total: number;
}

export interface BatchAddResult {
  added: number;
  skipped: number;
}

export interface BatchRemoveResult {
  removed: number;
}

export interface ScanProgress {
  current: number;
  total: number;
  percent: number;
}