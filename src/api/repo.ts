// 业务 API 层：所有操作都通过 Tauri invoke 调用 Rust 命令
// 数据库由 Rust 端的 rusqlite 持有，前端只发请求

import { invoke } from '@tauri-apps/api/core';
import type {
  FileItem,
  TagItem,
  TagGroup,
  SortOrderItem,
  SyncResult,
  RemapResult,
  BatchAddResult,
  BatchRemoveResult,
} from './types';

// ============================================================
// 文件查询
// ============================================================

export async function getFileTagsByPaths(filePaths: string[]): Promise<FileItem[]> {
  return invoke<FileItem[]>('get_file_tags_by_paths', { paths: filePaths });
}

export async function getScannedFiles(folderPath: string): Promise<FileItem[]> {
  return invoke<FileItem[]>('get_scanned_files', { folderPath });
}

// ============================================================
// 标签组
// ============================================================

export async function getTagGroups(): Promise<TagGroup[]> {
  return invoke<TagGroup[]>('get_tag_groups');
}

export async function createTagGroup(name: string): Promise<number | null> {
  return invoke<number>('create_tag_group', { name });
}

export async function updateTagGroup(groupId: number, name: string): Promise<boolean> {
  return invoke<boolean>('update_tag_group', { groupId, name });
}

export async function deleteTagGroup(groupId: number): Promise<boolean> {
  return invoke<boolean>('delete_tag_group', { groupId });
}

export async function updateTagGroupOrder(orders: SortOrderItem[]): Promise<boolean> {
  return invoke<boolean>('update_tag_group_order', { orders });
}

// ============================================================
// 标签
// ============================================================

export async function getTags(): Promise<TagItem[]> {
  return invoke<TagItem[]>('get_tags');
}

export async function createTag(
  name: string,
  color: string,
  groupId: number | null,
): Promise<number | null> {
  return invoke<number>('create_tag', { name, color, groupId });
}

export async function deleteTag(tagId: number): Promise<boolean> {
  return invoke<boolean>('delete_tag', { tagId });
}

export async function updateTagOrder(orders: SortOrderItem[]): Promise<boolean> {
  return invoke<boolean>('update_tag_order', { orders });
}

// ============================================================
// 文件-标签关联
// ============================================================

export async function addFileTag(
  fileId: number,
  tagId: number,
  filePath: string,
  fileName: string,
  isDirectory: boolean,
): Promise<boolean> {
  return invoke<boolean>('add_file_tag', {
    fileId,
    tagId,
    filePath,
    fileName,
    isDirectory,
  });
}

export async function removeFileTag(fileId: number, tagId: number): Promise<boolean> {
  return invoke<boolean>('remove_file_tag', { fileId, tagId });
}

export async function searchByTag(tagId: number): Promise<FileItem[]> {
  return invoke<FileItem[]>('search_by_tag', { tagId });
}

export async function deleteFile(fileId: number): Promise<boolean> {
  return invoke<boolean>('delete_file', { fileId });
}

// ============================================================
// 批量打标签
// ============================================================

export async function batchAddTags(
  filePaths: string[],
  tagIds: number[],
): Promise<BatchAddResult> {
  return invoke<BatchAddResult>('batch_add_tags', { filePaths, tagIds });
}

export async function batchRemoveTags(
  filePaths: string[],
  tagIds: number[],
): Promise<BatchRemoveResult> {
  return invoke<BatchRemoveResult>('batch_remove_tags', { filePaths, tagIds });
}

// ============================================================
// 同步与重映射
// ============================================================

export async function syncFolder(folderPath: string): Promise<SyncResult> {
  return invoke<SyncResult>('sync_folder', { folderPath });
}

export async function remapFolderTags(folderPath: string): Promise<RemapResult> {
  return invoke<RemapResult>('remap_folder_tags', { folderPath });
}

// ============================================================
// Repo 聚合对象（便于 App.tsx 统一调用）
// ============================================================

export const filesRepo = {
  addFileTag,
  removeFileTag,
  batchAddTags,
  batchRemoveTags,
  deleteFile,
  getByPaths: getFileTagsByPaths,
  getScannedFiles,
  syncFolder,
  remapFolderTags,
};

export const tagsRepo = {
  getTags,
  createTag,
  deleteTag,
  updateTagOrder,
};

export const groupsRepo = {
  getTagGroups,
  createTagGroup,
  updateTagGroup,
  deleteTagGroup,
  updateTagGroupOrder,
};

export const searchRepo = {
  searchByTag,
};