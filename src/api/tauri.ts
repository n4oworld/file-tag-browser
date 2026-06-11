// Tauri invoke 封装层
// 数据库已搬到 Rust 端（rusqlite），所有 CRUD 通过专门命令调用

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import type {
  ScanResult,
  DriveItem,
  FileStat,
  ScanProgress,
} from './types';

// 数据库路径（仅用于展示）
export const dbApi = {
  getDbPath: () => invoke<string>('get_db_path'),
};

// 文件系统命令（Rust 原生 IO）
export const fsApi = {
  scanFolder: (path: string) => invoke<ScanResult>('scan_folder', { path }),
  statPath: (path: string) => invoke<FileStat>('stat_path', { path }),
};

// 文件夹 UUID.tag 命令
export const folderTagApi = {
  createFolderTagFile: (folderPath: string) => invoke<string>('create_folder_tag_file', { folderPath }),
  readFolderTag: (folderPath: string) => invoke<string | null>('read_folder_tag', { folderPath }),
};

// 文件 hash
export const hashApi = {
  computeFileHash: (filePath: string) => invoke<string>('compute_file_hash', { filePath }),
};

// 驱动器枚举
export const drivesApi = {
  getDrives: () => invoke<DriveItem[]>('get_drives'),
};

// 对话框与打开文件
export const dialogApi = {
  openFolderDialog: () => invoke<string | null>('open_folder_dialog'),
  openFile: (path: string) => invoke<void>('open_file', { path }),
  openInExplorer: (path: string) => invoke<void>('open_in_explorer', { path }),
};

// 事件监听
export function onScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>('scan-progress', (e) => cb(e.payload));
}