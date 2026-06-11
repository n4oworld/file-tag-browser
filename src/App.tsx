import React, { useState, useEffect } from 'react';
import { Layout, Table, Button, Tag, Input, Modal, Form, message, Progress, Space, Tooltip, Breadcrumb, Tabs, Select } from 'antd';
import { FolderOpenOutlined, PlusOutlined, DeleteOutlined, FileOutlined, HomeOutlined, DatabaseOutlined, FolderOutlined, TagOutlined, EditOutlined, SearchOutlined, UpOutlined, SyncOutlined } from '@ant-design/icons';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { pinyin } from 'pinyin-pro';
import './App.css';
import { filesRepo, tagsRepo, groupsRepo, searchRepo } from './api/repo';
import { dialogApi, drivesApi, onScanProgress, fsApi } from './api/tauri';
import type { FileItem, TagItem, TagGroup, DriveItem, ScanResult, ScanFileItem } from './api/types';

interface BreadcrumbItem {
  path: string;
  name: string;
}

const { Header, Sider, Content } = Layout;

const APP_VERSION = '0.0.1';

function formatFileSize(bytes: number): string {
  if (!bytes) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString('zh-CN');
}

function fuzzyMatch(name: string, search: string): boolean {
  const lowerSearch = search.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerName.includes(lowerSearch)) return true;
  const namePinyin = pinyin(name, { toneType: 'none' }).replace(/\s/g, '');
  if (namePinyin.toLowerCase().includes(lowerSearch)) return true;
  return false;
}

interface SortableTagProps {
  tag: TagItem;
  onDelete: (tagId: number) => void;
}

function SortableTag({ tag, onDelete }: SortableTagProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: tag.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    marginBottom: 8,
    marginRight: 8,
    cursor: 'grab',
  };

  return (
    <Tag
      ref={setNodeRef}
      style={style}
      color={tag.color}
      closable
      onClose={(e) => { e.preventDefault(); onDelete(tag.id); }}
      {...attributes}
      {...listeners}
    >
      {tag.name}
    </Tag>
  );
}

interface SortableTagListProps {
  tags: TagItem[];
  onDelete: (tagId: number) => void;
  onReorder: (newTags: TagItem[]) => void;
}

function SortableTagList({ tags, onDelete, onReorder }: SortableTagListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  if (tags.length === 0) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
          const oldIndex = tags.findIndex(t => t.id === active.id);
          const newIndex = tags.findIndex(t => t.id === over.id);
          if (oldIndex !== -1 && newIndex !== -1) {
            const newTags = [...tags];
            const [removed] = newTags.splice(oldIndex, 1);
            newTags.splice(newIndex, 0, removed);
            onReorder(newTags);
          }
        }
      }}
    >
      <SortableContext items={tags.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {tags.map(tag => (
            <SortableTag key={tag.id} tag={tag} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

declare global {
  interface Window {
    electronAPI: {
      openFolder: () => Promise<string | null>;
      scanFolder: (path: string) => Promise<ScanResult>;
      getScannedFiles: (path: string) => Promise<FileItem[]>;
      getFileTagsByPaths: (paths: string[]) => Promise<FileItem[]>;
      getTags: () => Promise<TagItem[]>;
      getTagGroups: () => Promise<TagGroup[]>;
      updateTagOrder: (tagOrders: { id: number; sort_order: number }[]) => Promise<boolean>;
      updateTagGroupOrder: (groupOrders: { id: number; sort_order: number }[]) => Promise<boolean>;
      createTagGroup: (name: string) => Promise<number | null>;
      updateTagGroup: (groupId: number, name: string) => Promise<boolean>;
      deleteTagGroup: (groupId: number) => Promise<boolean>;
      createTag: (name: string, color: string, groupId: number | null) => Promise<number | null>;
      addFileTag: (fileId: number, tagId: number, filePath: string, fileName: string, isDirectory: boolean) => Promise<boolean>;
      removeFileTag: (fileId: number, tagId: number) => Promise<boolean>;
      searchByTag: (tagId: number) => Promise<FileItem[]>;
      deleteFile: (fileId: number) => Promise<boolean>;
      deleteTag: (tagId: number) => Promise<boolean>;
      openFile: (filePath: string) => Promise<void>;
      getDrives: () => Promise<DriveItem[]>;
      syncFolder: (folderPath: string) => Promise<{ synced: number; total: number }>;
      remapFolderTags: (folderPath: string) => Promise<{ mapped: number; total: number }>;
      batchAddTags: (filePaths: string[], tagIds: number[]) => Promise<{ added: number; skipped: number }>;
      batchRemoveTags: (filePaths: string[], tagIds: number[]) => Promise<{ removed: number }>;
      onScanProgress: (callback: (progress: { current: number; total: number; percent: number }) => void) => void;
    };
  }
}

export default function App() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<{ name: string; path: string; type: number }[]>([]);
  const [currentFolders, setCurrentFolders] = useState<{ name: string; path: string }[]>([]);
  const [tags, setTags] = useState<TagItem[]>([]);
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ path: '', name: '此电脑' }]);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagGroupModalVisible, setTagGroupModalVisible] = useState(false);
  const [editingTagGroup, setEditingTagGroup] = useState<TagGroup | null>(null);
  const [fileTagModalVisible, setFileTagModalVisible] = useState(false);
  const [fileTagSearchText, setFileTagSearchText] = useState('');
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [selectedIsDirectory, setSelectedIsDirectory] = useState<boolean>(false);
  const [searchText, setSearchText] = useState('');
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [isHome, setIsHome] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('browser');
  const [savedCurrentPath, setSavedCurrentPath] = useState<string>('');
  const [savedBreadcrumb, setSavedBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [savedIsHome, setSavedIsHome] = useState(true);
  const [searchTagIds, setSearchTagIds] = useState<number[]>([]);
  const [aboutModalVisible, setAboutModalVisible] = useState(false);
  const [helpModalVisible, setHelpModalVisible] = useState(false);
  const [deleteTagId, setDeleteTagId] = useState<number | null>(null);
  const [createTagGroupId, setCreateTagGroupId] = useState<number | null>(null);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set());
  const [batchTagModalVisible, setBatchTagModalVisible] = useState(false);
  const [batchTagAction, setBatchTagAction] = useState<'add' | 'remove'>('add');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedTagIdsForAdding, setSelectedTagIdsForAdding] = useState<Set<number>>(new Set());
  const [form] = Form.useForm();

  useEffect(() => {
    loadTags();
    loadTagGroups();
    onScanProgress((progress) => {
      setScanProgress(progress);
    });
    loadDrives();
  }, []);

  useEffect(() => {
    const filtered = files.filter(f =>
      f.file_name.toLowerCase().includes(searchText.toLowerCase())
    );
    setFilteredFiles(filtered);
  }, [files, searchText]);

  async function loadTags() {
    console.log('[loadTags] calling getTags API');
    const tagList = await tagsRepo.getTags();
    console.log('[loadTags] received:', tagList.length, 'tags', tagList);
    setTags(tagList);
  }

  async function loadTagGroups() {
    const groups = await groupsRepo.getTagGroups();
    setTagGroups(groups);
  }

  async function loadDrives() {
    const drives = await drivesApi.getDrives();
    setFolders(drives.map(d => ({ name: d.name, path: d.label + '\\', type: d.type })));
    setIsHome(true);
  }

  /**
   * navigateTo — 跳转到指定目录并渲染文件列表
   *
   * 执行流程（3个步骤）：
   *
   * 【步骤1】scanFolder — 扫描文件系统
   *   - 调用主进程 IPC scanFolder，传入目标路径
   *   - 主进程读取该目录下所有文件条目，区分文件/文件夹
   *   - 【注意】scanFolder 不入库任何数据，文件/文件夹在添加标签时才入库
   *   - 主进程返回：folders（子文件夹列表）、files（文件基本信息数组 path/name/isDirectory）
   *
   * 【步骤2】getFileTagsByPaths — 查询数据库标签
   *   - 从步骤1的返回值中提取所有条目的 path 数组
   *   - 调用主进程 IPC getFileTagsByPaths，批量查询这些条目在数据库中的记录及关联标签
   *   - 返回值：FileItem[]（包含 id, file_path, file_name, tags, tag_ids）
   *     注意：从未被扫描过且未添加过标签的文件不在数据库中，步骤2不会返回该记录
   *
   * 【步骤3】合并数据并渲染
   *   - 建立 path → 基础信息 的 Map（来自步骤1，初始 id=-1）
   *   - 遍历数据库返回的记录（步骤2），用查询到的完整信息覆盖 Map 中对应项
   *     （包含 id, tags, tag_ids）
   *   - 将 Map 转换为渲染列表，设置到 React state
   *
   * 注意事项：
   *   - 步骤1和步骤2是串行执行，步骤1完成后才会发起步骤2
   *   - 文件/文件夹在首次添加标签时才会入库，之前步骤2不会返回该记录（id=-1，标签为空）
   */
  async function navigateTo(path: string) {
    // ── 前置重置 ──
    if (!path) {
      loadDrives();
      return;
    }
    setCurrentPath(path);
    setScanProgress({ current: 0, total: 0, percent: 0 });
    setSelectedTagId(null);
    setIsHome(false);

    // ── 步骤1：扫描文件系统，获取子文件夹列表 + 文件/文件夹基本信息 ──
    // 返回结构：{ files: ScanFileItem[], folders: {name, path}[], total: number }
    // 注意：scanFolder 只读文件系统，不入库任何数据。文件/文件夹在首次添加标签时才会入库
    // 返回的 files 数组同时包含文件和文件夹，通过 isDirectory 区分（1=文件夹，0=文件）
    const result = await fsApi.scanFolder(path);

    // ── 步骤2：查询数据库，获取文件/文件夹的标签信息 ──
    const filePaths = result.files.map((f) => f.path);
    let taggedItems: FileItem[] = [];
    if (filePaths.length > 0) {
      taggedItems = await filesRepo.getByPaths(filePaths);
    }

    // ── 步骤3：合并文件数据和标签数据 ──
    //
    // 3.1 用扫描结果建立 path → 基础信息 的 Map
    //     初始状态：id=-1, tags=[], tag_ids=[]（待后面补充完整信息）
    const itemMap = new Map<string, any>();
    for (const f of result.files) {
      itemMap.set(f.path, {
        id: -1,         // 临时ID，数据库返回后会覆盖为真实ID
        file_path: f.path,
        file_name: f.name,
        file_size: 0,
        file_mtime: 0,
        file_hash: '',
        tags: [],
        tag_ids: [],
        is_directory: f.is_directory === 1,
      });
    }

    // 3.2 用数据库返回的完整记录覆盖 Map 中对应的项（补充 id, tags, tag_ids）
    for (const tf of taggedItems) {
      if (itemMap.has(tf.file_path)) {
        itemMap.set(tf.file_path, { ...itemMap.get(tf.file_path), ...tf });
      }
    }

    // 3.3 将 Map 转换为渲染列表
    const allItems: FileItem[] = Array.from(itemMap.values());

    // 3.4 更新 React state，触发 Table 渲染
    setFiles(allItems);
    setCurrentFolders([]);

    // ── 回到上级目录 ──
    // 从当前路径去掉最后一个 \ 分段，得到上级目录路径
    function getParentPath(p: string): string {
      // D:\work\project\ → D:\work\
      const trimmed = p.replace(/\\$/, ''); // 去掉末尾 \
      const lastSep = trimmed.lastIndexOf('\\');
      if (lastSep <= 1) return ''; // 到达磁盘根（如 D:\），返回空让 navigateTo 加载驱动器
      return trimmed.substring(0, lastSep + 1);
    }

    // ── 构建面包屑导航 ──
    // 将路径按 \ 分割，构建面包屑数组
    // 例如 D:\work\project → [ {path:'', name:'此电脑'}, {path:'D:\\', name:'D:'}, {path:'D:\\work\\', name:'work'}, {path:'D:\\work\\project\\', name:'project'} ]
    const parts = path.split('\\').filter(p => p);
    const crumbs: BreadcrumbItem[] = [{ path: '', name: '此电脑' }];
    let cumPath = '';
    for (const part of parts) {
      cumPath += part + '\\';
      crumbs.push({ path: cumPath, name: part });
    }
    setBreadcrumb(crumbs);

    // 清除进度
    setScanProgress(null);
  }

  async function handleBreadcrumbClick(item: BreadcrumbItem) {
    if (!item.path) {
      loadDrives();
      setBreadcrumb([{ path: '', name: '此电脑' }]);
      setFiles([]);
      setCurrentPath('');
    } else {
      navigateTo(item.path);
    }
  }

  async function handleOpenFolder() {
    const folderPath = await dialogApi.openFolderDialog();
    if (folderPath) {
      navigateTo(folderPath);
    }
  }

  async function handleTagClick(tagId: number) {
    if (selectedTagId === tagId) {
      setSelectedTagId(null);
      if (currentPath) {
        const fileList = await filesRepo.getScannedFiles(currentPath);
        setFiles(fileList);
      }
    } else {
      setSelectedTagId(tagId);
      const fileList = await searchRepo.searchByTag(tagId);
      setFiles(fileList);
    }
  }

  async function handleCreateTag() {
    const values = await form.validateFields();
    const groupId = values.groupId ?? createTagGroupId;
    await tagsRepo.createTag(values.name, values.color, groupId);
    message.success('标签创建成功');
    setTagModalVisible(false);
    setCreateTagGroupId(null);
    form.resetFields();
    loadTags();
  }

  /**
   * handleAddTagToFile — 将指定标签添加到当前选中的文件
   *
   * 【前置条件】
   *   - selectedFileId 必须有值（由 openFileTagModal 设置）
   *
   * 【执行流程】
   *   1. 调用 IPC addFileTag(selectedFileId, tagId)
   *      → 写入 file_tags 关联表（file_id, tag_id）
   *      → 若记录已存在（UNIQUE 约束），SQLite 无操作不报错
   *   2. 成功后弹出成功提示
   *   3. 单独查询该文件更新后的完整记录（包含新添加的标签）
   *   4. 在 files state 中原地替换该文件（不触发全量刷新）
   *
   * @param tagId 要添加的标签ID
   */
  async function handleAddTagToFile(tagId: number) {
    // selectedFileId 可能是 -1（未入库），但 selectedFilePath 一定有值
    console.log('[handleAddTagToFile] START', {
      selectedFileId, selectedFilePath, selectedFileName, selectedIsDirectory, tagId,
      filesCount: files.length
    });

    const result = await filesRepo.addFileTag(
      selectedFileId ?? -1,
      tagId,
      selectedFilePath,
      selectedFileName,
      selectedIsDirectory
    );
    console.log('[handleAddTagToFile] addFileTag result:', result);
    if (!result) {
      message.error('标签添加失败');
      return;
    }

    message.success('标签添加成功');

    // 单独查询该文件更新后的完整数据（包含所有关联标签）
    const updatedFiles = await filesRepo.getByPaths([selectedFilePath]);
    console.log('[handleAddTagToFile] getFileTagsByPaths result:', JSON.stringify(updatedFiles), 'count:', updatedFiles.length);

    if (updatedFiles.length > 0) {
      // 局部更新：用数据库返回的完整记录替换对应项，其余不变
      setFiles(prev => {
        const idx = prev.findIndex(f => f.file_path === selectedFilePath);
        console.log('[handleAddTagToFile] setFiles callback', { idx, selectedFilePath, prevLength: prev.length });
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...prev[idx], ...updatedFiles[0] };
          console.log('[handleAddTagToFile] setFiles updated idx', idx, 'nextLength:', next.length);
          return next;
        }
        console.log('[handleAddTagToFile] setFiles idx === -1, returning prev unchanged');
        return prev;
      });
    } else {
      // 理论上是首次入库，getFileTagsByPaths 应该能查到
      // 如果查不到，强制刷新整个视图
      console.log('[handleAddTagToFile] updatedFiles empty, calling refreshCurrentView');
      refreshCurrentView();
    }
  }

  async function handleRemoveTag(fileId: number, tagId: number, filePath: string) {
    const result = await filesRepo.removeFileTag(fileId, tagId);
    if (!result) {
      message.error('标签移除失败');
      return;
    }
    message.success('标签移除成功');

    // 局部更新：重新查询该文件的最新数据，替换列表中对应项
    const updatedFiles = await filesRepo.getByPaths([filePath]);
    setFiles(prev => {
      const idx = prev.findIndex(f => f.file_path === filePath);
      if (idx !== -1) {
        const next = [...prev];
        if (updatedFiles.length > 0) {
          next[idx] = { ...prev[idx], ...updatedFiles[0] };
        } else {
          // 标签全移除了，tag_ids 和 tags 置空
          next[idx] = { ...prev[idx], tag_ids: [], tags: [] };
        }
        return next;
      }
      return prev;
    });
  }

  async function handleDeleteTag(tagId: number) {
    setDeleteTagId(tagId);
  }

  async function confirmDeleteTag() {
    if (deleteTagId === null) return;
    await tagsRepo.deleteTag(deleteTagId);
    message.success('标签删除成功');
    if (selectedTagId === deleteTagId) {
      setSelectedTagId(null);
    }
    loadTags();
    setDeleteTagId(null);
  }

  async function handleCreateTagGroup() {
    const values = await form.validateFields();
    if (editingTagGroup) {
      await groupsRepo.updateTagGroup(editingTagGroup.id, values.name);
      message.success('标签组已更新');
    } else {
      await groupsRepo.createTagGroup(values.name);
      message.success('标签组创建成功');
    }
    setTagGroupModalVisible(false);
    setEditingTagGroup(null);
    form.resetFields();
    loadTagGroups();
  }

  async function handleDeleteTagGroup(groupId: number) {
    await groupsRepo.deleteTagGroup(groupId);
    message.success('标签组已删除');
    loadTagGroups();
    loadTags();
  }

  async function handleSearchByTag(tagId: number) {
    const newTagIds = searchTagIds.includes(tagId)
      ? searchTagIds.filter(id => id !== tagId)
      : [...searchTagIds, tagId];
    setSearchTagIds(newTagIds);

    if (newTagIds.length === 0) {
      setSearchResults([]);
    } else if (newTagIds.length === 1) {
      const results = await searchRepo.searchByTag(newTagIds[0]);
      setSearchResults(results);
    } else {
      // Multi-tag search - get files that have ALL selected tags
      const allResults = await Promise.all(newTagIds.map(id => searchRepo.searchByTag(id)));
      const fileMap = new Map<number, FileItem>();
      for (const results of allResults) {
        for (const file of results) {
          if (fileMap.has(file.id)) {
            fileMap.set(file.id, { ...file, tags: [...fileMap.get(file.id)!.tags, ...file.tags] });
          } else {
            fileMap.set(file.id, { ...file });
          }
        }
      }
      // Filter to only files that have ALL selected tags
      const finalResults: FileItem[] = [];
      for (const file of fileMap.values()) {
        const fileTagIds = file.tag_ids || [];
        const hasAllTags = newTagIds.every(id => fileTagIds.includes(id));
        if (hasAllTags) {
          finalResults.push(file);
        }
      }
      setSearchResults(finalResults);
    }
  }

  async function refreshCurrentView() {
    if (currentPath) {
      navigateTo(currentPath);
    }
  }

  /**
   * openFileTagModal — 打开"添加标签"弹窗
   *
   * 【前置校验】
   *   - fileId 为空或为 -1（文件夹占位ID）时直接返回，不弹窗
   *
   * 【弹窗打开流程】
   *   1. setSelectedFileId(fileId) — 记录当前要打标签的文件ID
   *   2. loadTags() — 重新加载标签列表（确保弹窗内标签最新）
   *   3. setFileTagModalVisible(true) — 展开弹窗
   *
   * 【弹窗内容】
   *   遍历 tagGroups + 未分组标签，点击某个 Tag 调用 handleAddTagToFile
   *   弹窗关闭由 setFileTagModalVisible(false) 手动处理（footer={null}，无默认按钮）
   *
   * @param fileId 文件在数据库中的ID（来自 files 表的主键）
   */
  function openFileTagModal(fileId: number, filePath: string, fileName: string, isDirectory: boolean) {
    setSelectedFileId(fileId);
    setSelectedFilePath(filePath);
    setSelectedFileName(fileName);
    setSelectedIsDirectory(isDirectory);
    loadTags();
    setFileTagModalVisible(true);
  }

  function openFile(filePath: string) {
    dialogApi.openFile(filePath);
  }


  const columns = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
      render: (name: string, record: FileItem) => (
        <Space>
          {record.is_directory ? <FolderOutlined style={{ color: '#faad14' }} /> : <FileOutlined />}
          <span
            style={{ cursor: 'pointer', color: record.is_directory ? '#1890ff' : '#1890ff' }}
            onClick={() => record.is_directory ? navigateTo(record.file_path) : openFile(record.file_path)}
          >
            {name}
          </span>
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (size: number, record: FileItem) => record.is_directory ? '-' : formatFileSize(size),
    },
    {
      title: '修改时间',
      dataIndex: 'file_mtime',
      key: 'file_mtime',
      width: 180,
      render: (time: number, record: FileItem) => record.is_directory ? '-' : formatTime(time),
    },
    {
      title: '标签',
      key: 'tags',
      render: (_: any, record: FileItem) => {
        // 文件夹和文件都显示已有标签 + 添加按钮（文件夹入库后也有真实 ID）
        return (
          <>
            {record.tag_ids.map((tagId) => {
              const tag = tags.find(t => t.id === tagId);
              return tag ? (
                <Tag
                  key={tagId}
                  color={tag.color}
                  closable
                  onClose={() => handleRemoveTag(record.id, tagId, record.file_path)}
                >
                  {tag.name}
                </Tag>
              ) : null;
            })}
            <Tag icon={<PlusOutlined />} onClick={(e) => {
              openFileTagModal(record.id, record.file_path, record.file_name, !!record.is_directory);
            }}>
              添加
            </Tag>
          </>
        );
      },
    },
  ];

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout>
        <Sider width={80} style={{ background: '#fff' }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              onClick={() => {
                if (savedCurrentPath) {
                  setCurrentPath(savedCurrentPath);
                  setBreadcrumb(savedBreadcrumb);
                  setIsHome(savedIsHome);
                  if (!savedIsHome) {
                    fsApi.scanFolder(savedCurrentPath).then(result => {
                      // 复用 navigateTo 的合并逻辑，统一处理文件和文件夹的标签
                      const filePaths = result.files.map((f: any) => f.path);
                      filesRepo.getByPaths(filePaths).then(taggedItems => {
                        const itemMap = new Map<string, any>();
                        for (const f of result.files) {
                          itemMap.set(f.path, {
                            id: -1,
                            file_path: f.path,
                            file_name: f.name,
                            file_size: 0,
                            file_mtime: 0,
                            file_hash: '',
                            tags: [],
                            tag_ids: [],
                            is_directory: f.is_directory === 1,
                          });
                        }
                        for (const tf of taggedItems) {
                          if (itemMap.has(tf.file_path)) {
                            itemMap.set(tf.file_path, { ...itemMap.get(tf.file_path), ...tf });
                          }
                        }
                        setFiles(Array.from(itemMap.values()));
                      });
                    });
                  }
                } else {
                  loadDrives();
                }
                setActiveTab('browser');
              }}
              style={{
                padding: '16px 8px',
                cursor: 'pointer',
                background: activeTab === 'browser' ? '#e6f7ff' : 'transparent',
                color: activeTab === 'browser' ? '#1890ff' : '#000',
                borderBottom: activeTab === 'browser' ? '2px solid #1890ff' : '2px solid transparent',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <FolderOpenOutlined style={{ fontSize: 20 }} />
              <span style={{ fontSize: 11 }}>文件浏览</span>
            </div>
            <div
              onClick={() => {
                setSavedCurrentPath(currentPath);
                setSavedBreadcrumb(breadcrumb);
                setSavedIsHome(isHome);
                setActiveTab('tags');
                loadTags();
                loadTagGroups();
              }}
              style={{
                padding: '16px 8px',
                cursor: 'pointer',
                background: activeTab === 'tags' ? '#e6f7ff' : 'transparent',
                color: activeTab === 'tags' ? '#1890ff' : '#000',
                borderBottom: activeTab === 'tags' ? '2px solid #1890ff' : '2px solid transparent',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <TagOutlined style={{ fontSize: 20 }} />
              <span style={{ fontSize: 11 }}>标签管理</span>
            </div>
            <div
              onClick={() => { setActiveTab('search'); }}
              style={{
                padding: '16px 8px',
                cursor: 'pointer',
                background: activeTab === 'search' ? '#e6f7ff' : 'transparent',
                color: activeTab === 'search' ? '#1890ff' : '#000',
                borderBottom: activeTab === 'search' ? '2px solid #1890ff' : '2px solid transparent',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <SearchOutlined style={{ fontSize: 20 }} />
              <span style={{ fontSize: 11 }}>标签搜索</span>
            </div>
            <div style={{ flex: 1 }} />
            <div
              onClick={() => { setHelpModalVisible(true); }}
              style={{
                padding: '16px 8px',
                cursor: 'pointer',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                marginTop: 'auto',
              }}
            >
              <span style={{ fontSize: 16 }}>📖</span>
              <span style={{ fontSize: 11 }}>使用说明</span>
            </div>
            <div
              onClick={() => { setAboutModalVisible(true); }}
              style={{
                padding: '16px 8px',
                cursor: 'pointer',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span style={{ fontSize: 16 }}>ℹ️</span>
              <span style={{ fontSize: 11 }}>关于</span>
            </div>
          </div>
        </Sider>
        <Content style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          {activeTab === 'tags' ? (
            <div style={{ padding: '16px' }}>
              <Space style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingTagGroup(null);
                    form.resetFields();
                    setTagGroupModalVisible(true);
                  }}
                >
                  新建标签组
                </Button>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    form.resetFields();
                    setTagModalVisible(true);
                  }}
                >
                  新建标签
                </Button>
              </Space>
              <div>
                {tagGroups.map(group => {
                  const groupTags = tags.filter(t => t.group_id === group.id);
                  return (
                    <div key={group.id} style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 'bold', fontSize: 16 }}>{group.name}</span>
                        <Space style={{ marginLeft: 8 }}>
                          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => {
                            setEditingTagGroup(group);
                            form.setFieldsValue({ name: group.name });
                            setTagGroupModalVisible(true);
                          }} />
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTagGroup(group.id)} />
                        </Space>
                      </div>
                      <div style={{ paddingLeft: 16 }}>
                        <SortableTagList
                          tags={groupTags}
                          onDelete={handleDeleteTag}
                          onReorder={(newTags) => {
                            const tagOrders = newTags.map((t, i) => ({ id: t.id, sort_order: i }));
                            tagsRepo.updateTagOrder(tagOrders);
                            loadTags();
                          }}
                        />
                        <Button
                          type="link"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setCreateTagGroupId(group.id);
                            form.resetFields();
                            setTagModalVisible(true);
                          }}
                          style={{ marginTop: 8 }}
                        >
                          添加标签
                        </Button>
                        {groupTags.length === 0 && <span style={{ color: '#999', fontSize: 12 }}>暂无标签</span>}
                      </div>
                    </div>
                  );
                })}
                {tagGroups.length === 0 && tags.filter(t => t.group_id === null).length === 0 && (
                  <div style={{ color: '#999' }}>暂无标签组</div>
                )}
                {tags.filter(t => t.group_id === null).length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 'bold', fontSize: 14, color: '#666', marginBottom: 8 }}>未分组</div>
                    <SortableTagList
                      tags={tags.filter(t => t.group_id === null)}
                      onDelete={handleDeleteTag}
                      onReorder={(newTags) => {
                        const tagOrders = newTags.map((t, i) => ({ id: t.id, sort_order: i }));
                        tagsRepo.updateTagOrder(tagOrders);
                        loadTags();
                      }}
                    />
                    <Button
                      type="link"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setCreateTagGroupId(null);
                        form.resetFields();
                        setTagModalVisible(true);
                      }}
                      style={{ marginTop: 8 }}
                    >
                      添加标签
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'search' ? (
            <div style={{ padding: '16px' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 'bold' }}>选择标签搜索文件（多选）</div>
                  {searchTagIds.length > 0 && (
                    <Button size="small" style={{ marginLeft: 16 }} onClick={() => { setSearchTagIds([]); setSearchResults([]); }}>
                      清空
                    </Button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tagGroups.map(group => {
                    const groupTags = tags.filter(t => t.group_id === group.id);
                    if (groupTags.length === 0) return null;
                    return (
                      <div key={group.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 12, color: '#666', minWidth: 80 }}>{group.name}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {groupTags.map(tag => (
                            <Tag
                              key={tag.id}
                              color={tag.color}
                              style={{ cursor: 'pointer', opacity: searchTagIds.includes(tag.id) ? 1 : 0.5 }}
                              onClick={() => handleSearchByTag(tag.id)}
                            >
                              {searchTagIds.includes(tag.id) && '✓ '}{tag.name}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {tags.filter(t => t.group_id === null).length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#666', minWidth: 80 }}>未分组</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {tags.filter(t => t.group_id === null).map(tag => (
                          <Tag
                            key={tag.id}
                            color={tag.color}
                            style={{ cursor: 'pointer', opacity: searchTagIds.includes(tag.id) ? 1 : 0.5 }}
                            onClick={() => handleSearchByTag(tag.id)}
                          >
                            {searchTagIds.includes(tag.id) && '✓ '}{tag.name}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {searchResults.length > 0 && (
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: 8 }}>搜索结果 ({searchResults.length})</div>
                  <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                    {searchResults.map(file => (
                      <div key={file.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                            {file.is_directory ? <FolderOutlined style={{ color: '#faad14' }} /> : <FileOutlined />}
                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.file_name}</span>
                          </div>
                          <Space size={4} onClick={(e) => e.stopPropagation()}>
                            {file.is_directory ? (
                              <Tooltip title="打开目录">
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<FolderOpenOutlined />}
                                  onClick={() => dialogApi.openInExplorer(file.file_path)}
                                />
                              </Tooltip>
                            ) : (
                              <>
                                <Tooltip title="打开文件">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<FileOutlined />}
                                    onClick={() => dialogApi.openFile(file.file_path)}
                                  />
                                </Tooltip>
                                <Tooltip title="打开所在目录">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<FolderOpenOutlined />}
                                    onClick={() => {
                                      const sep = file.file_path.includes('\\') ? '\\' : '/';
                                      const lastIdx = file.file_path.lastIndexOf(sep);
                                      let dir: string;
                                      if (lastIdx <= 2) {
                                        // 文件在盘符根目录，例如 D:\file.txt → D:\
                                        dir = file.file_path.substring(0, 2) + sep;
                                      } else {
                                        dir = file.file_path.substring(0, lastIdx);
                                      }
                                      dialogApi.openInExplorer(dir);
                                    }}
                                  />
                                </Tooltip>
                              </>
                            )}
                          </Space>
                        </div>
                        <div style={{ color: '#999', fontSize: 12, marginTop: 4, wordBreak: 'break-all' }}>{file.file_path}</div>
                        <div style={{ marginTop: 4 }}>
                          {file.tag_ids.map((tagId) => {
                            const tag = tags.find(t => t.id === tagId);
                            return tag ? (
                              <Tag key={tagId} color={tag.color} style={{ marginRight: 4 }}>{tag.name}</Tag>
                            ) : null;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {searchTagIds.length > 0 && searchResults.length === 0 && (
                <div style={{ color: '#999' }}>没有找到同时包含所选标签的文件</div>
              )}
            </div>
          ) : (
            <>
              {scanProgress && scanProgress.total > 0 && (
                <Progress
                  percent={scanProgress.percent}
                  status="active"
                  style={{ marginBottom: 16 }}
                  format={() => `${scanProgress.current}/${scanProgress.total}`}
                />
              )}

              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16, flexShrink: 0, gap: 8 }}>
                <HomeOutlined
                  style={{ color: '#666', cursor: 'pointer' }}
                  onClick={() => {
                    loadDrives();
                    setCurrentPath('');
                    setBreadcrumb([{ path: '', name: '此电脑' }]);
                    setFiles([]);
                    setIsHome(true);
                  }}
                />
                {!isHome && currentPath && (() => {
                  const trimmed = currentPath.replace(/\\$/, '');
                  const lastSep = trimmed.lastIndexOf('\\');
                  const parentPath = lastSep <= 1 ? '' : trimmed.substring(0, lastSep + 1);
                  return (
                    <UpOutlined
                      style={{ color: '#666', cursor: 'pointer', fontSize: 14 }}
                      onClick={() => navigateTo(parentPath)}
                      title="回到上级目录"
                    />
                  );
                })()}
                <Input
                  value={currentPath || ''}
                  onChange={(e) => setCurrentPath(e.target.value)}
                  onPressEnter={() => {
                    const path = currentPath?.trim();
                    if (path) {
                      // Add trailing backslash if missing
                      const fullPath = path.endsWith('\\') || path.endsWith(':') ? path : path + '\\';
                      navigateTo(fullPath);
                    }
                  }}
                  placeholder="粘贴路径后按回车跳转"
                  style={{ flex: 1 }}
                />
                {!isHome && currentPath && (
                  <>
                    <Tooltip title="刷新文件列表：重新扫描当前文件夹">
                      <Button
                        icon={<SyncOutlined spin={isRefreshing} />}
                        onClick={async () => {
                          if (!currentPath || isRefreshing) return;
                          setIsRefreshing(true);
                          try {
                            await navigateTo(currentPath);
                          } finally {
                            setIsRefreshing(false);
                          }
                        }}
                      >
                        刷新
                      </Button>
                    </Tooltip>
                    <Tooltip title="同步标签：扫描当前文件夹，通过hash匹配数据库中已有文件并复制标签">
                      <Button
                        icon={<SyncOutlined />}
                        onClick={async () => {
                          if (!currentPath) return;
                          const result = await filesRepo.syncFolder(currentPath);
                          message.success(`同步完成：扫描了 ${result.total} 个文件，匹配并同步了 ${result.synced} 个文件`);
                          refreshCurrentView();
                        }}
                      >
                        同步标签
                      </Button>
                    </Tooltip>
                  </>
                )}
              </div>

              {isHome ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, overflow: 'auto', flex: 1, alignContent: 'start' }}>
                  {folders.map(folder => (
                    <div
                      key={folder.path}
                      style={{
                        padding: 20,
                        cursor: 'pointer',
                        border: '1px solid #d9d9d9',
                        borderRadius: 12,
                        background: '#fff',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        minHeight: 120,
                      }}
                      onClick={() => navigateTo(folder.path)}
                      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; e.currentTarget.style.borderColor = '#1890ff'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; e.currentTarget.style.borderColor = '#d9d9d9'; }}
                    >
                      <DatabaseOutlined style={{ fontSize: 40, color: folder.type === 4 ? '#52c41a' : '#1890ff', marginBottom: 8 }} />
                      <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 4 }}>{folder.name}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{folder.type === 4 ? '网络磁盘' : '本地磁盘'}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <div style={{ marginBottom: 8, padding: '8px', background: '#f0f0f0', borderRadius: 4 }}>
                    <Space>
                      <span>{selectedFilePaths.size > 0 ? `已选择 ${selectedFilePaths.size} 个文件` : '请勾选文件'}</span>
                      <Button size="small" disabled={selectedFilePaths.size === 0} onClick={() => { setBatchTagAction('add'); setBatchTagModalVisible(true); }}>批量添加标签</Button>
                      <Button size="small" disabled={selectedFilePaths.size === 0} onClick={() => { setBatchTagAction('remove'); setBatchTagModalVisible(true); }}>批量移除标签</Button>
                      {selectedFilePaths.size > 0 && <Button size="small" type="text" onClick={() => setSelectedFilePaths(new Set())}>取消选择</Button>}
                    </Space>
                  </div>
                  <Table
                    dataSource={filteredFiles}
                    columns={columns}
                    rowKey={(record: FileItem) => record.file_path + (record.is_directory ? '_dir' : '_file')}
                    pagination={false}
                    scroll={{ y: 'calc(100vh - 200px)' }}
                    style={{ fontSize: 12 }}
                    size="small"
                    rowSelection={{
                      selectedRowKeys: Array.from(selectedFilePaths),
                    onChange: (selectedRowKeys) => {
                      setSelectedFilePaths(new Set(selectedRowKeys as string[]));
                    },
                  }}
                />
                </div>
              )}
            </>
          )}
        </Content>

        <Modal
          title="创建标签"
          open={tagModalVisible}
          onOk={handleCreateTag}
          onCancel={() => { setTagModalVisible(false); setCreateTagGroupId(null); }}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="标签名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="color" label="颜色" initialValue="#808080">
              <Input type="color" style={{ width: 100 }} />
            </Form.Item>
            {createTagGroupId !== null ? (
              <Form.Item label="所属分组">
                <Input disabled value={tagGroups.find(g => g.id === createTagGroupId)?.name || ''} />
              </Form.Item>
            ) : (
              <Form.Item name="groupId" label="所属分组">
                <Select allowClear placeholder="请选择分组（可选）">
                  {tagGroups.map(g => (
                    <Select.Option key={g.id} value={g.id}>{g.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </Form>
        </Modal>

        <Modal
          title={editingTagGroup ? "编辑标签组" : "创建标签组"}
          open={tagGroupModalVisible}
          onOk={handleCreateTagGroup}
          onCancel={() => {
            setTagGroupModalVisible(false);
            setEditingTagGroup(null);
            form.resetFields();
          }}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="标签组名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="添加标签"
          open={fileTagModalVisible}
          onCancel={() => { setFileTagModalVisible(false); setFileTagSearchText(''); setSelectedTagIdsForAdding(new Set()); }}
          footer={null}
        >
          <div>
            {tags.length === 0 ? (
              <div style={{ color: '#999' }}>暂无标签，请先创建标签</div>
            ) : (
              <>
                <Input
                  placeholder="搜索标签（支持中文拼音搜索，如：zhou 匹配 周）"
                  value={fileTagSearchText}
                  onChange={(e) => setFileTagSearchText(e.target.value)}
                  style={{ marginBottom: 16 }}
                  allowClear
                />
                {(() => {
                  const filteredTags = fileTagSearchText.trim()
                    ? tags.filter(t => fuzzyMatch(t.name, fileTagSearchText.trim()))
                    : tags;
                  const filteredGroups = tagGroups.filter(g => filteredTags.some(t => t.group_id === g.id));
                  const ungroupedFiltered = filteredTags.filter(t => t.group_id === null);
                  return (
                    <>
                      {filteredGroups.map(group => {
                        const groupTags = filteredTags.filter(t => t.group_id === group.id);
                        if (groupTags.length === 0) return null;
                        return (
                          <div key={group.id} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 12, color: '#666', marginBottom: 4 }}>{group.name}</div>
                            {groupTags.map(tag => (
                              <Tag
                                key={tag.id}
                                color={selectedTagIdsForAdding.has(tag.id) ? tag.color : undefined}
                                style={{ cursor: 'pointer', margin: 4, border: selectedTagIdsForAdding.has(tag.id) ? '2px solid' : '1px solid transparent' }}
                                onClick={() => {
                                  const newSelected = new Set(selectedTagIdsForAdding);
                                  if (newSelected.has(tag.id)) {
                                    newSelected.delete(tag.id);
                                  } else {
                                    newSelected.add(tag.id);
                                  }
                                  setSelectedTagIdsForAdding(newSelected);
                                }}
                              >
                                {selectedTagIdsForAdding.has(tag.id) && '✓ '}{tag.name}
                              </Tag>
                            ))}
                          </div>
                        );
                      })}
                      {ungroupedFiltered.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 'bold', fontSize: 12, color: '#666', marginBottom: 4 }}>未分组</div>
                          {ungroupedFiltered.map(tag => (
                            <Tag
                              key={tag.id}
                              color={selectedTagIdsForAdding.has(tag.id) ? tag.color : undefined}
                              style={{ cursor: 'pointer', margin: 4, border: selectedTagIdsForAdding.has(tag.id) ? '2px solid' : '1px solid transparent' }}
                              onClick={() => {
                                const newSelected = new Set(selectedTagIdsForAdding);
                                if (newSelected.has(tag.id)) {
                                  newSelected.delete(tag.id);
                                } else {
                                  newSelected.add(tag.id);
                                }
                                setSelectedTagIdsForAdding(newSelected);
                              }}
                            >
                              {selectedTagIdsForAdding.has(tag.id) && '✓ '}{tag.name}
                            </Tag>
                          ))}
                        </div>
                      )}
                      {filteredTags.length === 0 && (
                        <div style={{ color: '#999' }}>没有找到匹配的标签</div>
                      )}
                    </>
                  );
                })()}
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    disabled={selectedTagIdsForAdding.size === 0}
                    onClick={async () => {
                      if (!selectedFileId || selectedTagIdsForAdding.size === 0) return;
                      for (const tagId of selectedTagIdsForAdding) {
                        await filesRepo.addFileTag(
                          selectedFileId,
                          tagId,
                          selectedFilePath,
                          selectedFileName,
                          selectedIsDirectory
                        );
                      }
                      message.success(`已添加 ${selectedTagIdsForAdding.size} 个标签`);
                      setFileTagModalVisible(false);
                      setFileTagSearchText('');
                      setSelectedTagIdsForAdding(new Set());
                      refreshCurrentView();
                    }}
                  >
                    添加 {selectedTagIdsForAdding.size > 0 ? `(${selectedTagIdsForAdding.size})` : ''}
                  </Button>
                  <Button onClick={() => { setSelectedTagIdsForAdding(new Set()); }}>清除选择</Button>
                  {selectedIsDirectory && (
                    <Button
                      onClick={async () => {
                        if (!selectedFilePath) return;
                        const result = await filesRepo.remapFolderTags(selectedFilePath);
                        message.success(`重新映射完成：为 ${result.mapped} 个子项映射了标签`);
                        setFileTagModalVisible(false);
                        setFileTagSearchText('');
                        setSelectedTagIdsForAdding(new Set());
                        refreshCurrentView();
                      }}
                    >
                      重新映射子项标签
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>

        <Modal
          title={batchTagAction === 'add' ? '批量添加标签' : '批量移除标签'}
          open={batchTagModalVisible}
          onCancel={() => setBatchTagModalVisible(false)}
          footer={null}
        >
          <div>
            <Input
              placeholder="搜索标签（支持中文拼音搜索）"
              value={fileTagSearchText}
              onChange={(e) => setFileTagSearchText(e.target.value)}
              style={{ marginBottom: 16 }}
              allowClear
            />
            {tags.length === 0 ? (
              <div style={{ color: '#999' }}>暂无标签，请先创建标签</div>
            ) : (
              <>
                {(() => {
                  const filteredTags = fileTagSearchText.trim()
                    ? tags.filter(t => fuzzyMatch(t.name, fileTagSearchText.trim()))
                    : tags;
                  const filteredGroups = tagGroups.filter(g => filteredTags.some(t => t.group_id === g.id));
                  const ungroupedFiltered = filteredTags.filter(t => t.group_id === null);
                  return (
                    <>
                      {filteredGroups.map(group => {
                        const groupTags = filteredTags.filter(t => t.group_id === group.id);
                        if (groupTags.length === 0) return null;
                        return (
                          <div key={group.id} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 'bold', fontSize: 12, color: '#666', marginBottom: 4 }}>{group.name}</div>
                            {groupTags.map(tag => (
                              <Tag
                                key={tag.id}
                                color={tag.color}
                                style={{ cursor: 'pointer', margin: 4 }}
                                onClick={async () => {
                                  const rawPaths = Array.from(selectedFilePaths);
                                  const filePaths = rawPaths.map(p => p.replace(/_file$|_dir$/, ''));
                                  if (batchTagAction === 'add') {
                                    const result = await filesRepo.batchAddTags(filePaths, [tag.id]);
                                    message.success(`已添加 ${result.added} 个，忽略 ${result.skipped} 个已存在的`);
                                  } else {
                                    const result = await filesRepo.batchRemoveTags(filePaths, [tag.id]);
                                    message.success(`已移除 ${result.removed} 个`);
                                  }
                                  setBatchTagModalVisible(false);
                                  setFileTagSearchText('');
                                  setSelectedFilePaths(new Set());
                                  refreshCurrentView();
                                }}
                              >
                                {tag.name}
                              </Tag>
                            ))}
                          </div>
                        );
                      })}
                      {ungroupedFiltered.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontWeight: 'bold', fontSize: 12, color: '#666', marginBottom: 4 }}>未分组</div>
                          {ungroupedFiltered.map(tag => (
                            <Tag
                              key={tag.id}
                              color={tag.color}
                              style={{ cursor: 'pointer', margin: 4 }}
                              onClick={async () => {
                                const rawPaths = Array.from(selectedFilePaths);
                                const filePaths = rawPaths.map(p => p.replace(/_file$|_dir$/, ''));
                                if (batchTagAction === 'add') {
                                  const result = await filesRepo.batchAddTags(filePaths, [tag.id]);
                                  message.success(`已添加 ${result.added} 个，忽略 ${result.skipped} 个已存在的`);
                                } else {
                                  const result = await filesRepo.batchRemoveTags(filePaths, [tag.id]);
                                  message.success(`已移除 ${result.removed} 个`);
                                }
                                setBatchTagModalVisible(false);
                                setFileTagSearchText('');
                                setSelectedFilePaths(new Set());
                                refreshCurrentView();
                              }}
                            >
                              {tag.name}
                            </Tag>
                          ))}
                        </div>
                      )}
                      {filteredTags.length === 0 && (
                        <div style={{ color: '#999' }}>没有找到匹配的标签</div>
                      )}
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </Modal>

        <Modal
          title="关于"
          open={aboutModalVisible}
          onCancel={() => setAboutModalVisible(false)}
          footer={null}
          width={480}
        >
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏷️</div>
            <div style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>文件标签浏览器</div>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>版本 {APP_VERSION}</div>
            <div style={{ fontSize: 14, color: '#333', marginBottom: 16 }}>
              一个支持标签式管理文件的文件浏览器程序
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
              作者：n4oworld
            </div>
            <div style={{ fontSize: 12, color: '#1890ff', cursor: 'pointer', marginBottom: 24 }}>
              GitHub：https://github.com/n4oworld/file-tag-browser
            </div>
            <div style={{ fontSize: 12, color: '#999', borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
              MIT License<br />
              Copyright (c) 2026 Your Name<br />
              Permission is hereby granted, free of charge, to any person obtaining a copy of this software...
            </div>
            <div>本软件代码完全由AI实现</div>
          </div>
        </Modal>

        <Modal
          title="使用说明"
          open={helpModalVisible}
          onCancel={() => setHelpModalVisible(false)}
          footer={null}
          width={560}
        >
          <div style={{ padding: '8px 0', lineHeight: 1.8, fontSize: 14 }}>
            <h4 style={{ margin: '8px 0' }}>1. 文件浏览</h4>
            <p style={{ margin: '4px 0' }}>点击「文件浏览」进入主界面，左侧栏显示本地盘符。</p>
            <p style={{ margin: '4px 0' }}>逐级点击文件夹浏览内容，文件夹可右键重命名、移动、删除。</p>

            <h4 style={{ margin: '12px 0 8px' }}>2. 标签管理</h4>
            <p style={{ margin: '4px 0' }}>点击「标签管理」创建标签组与标签，支持拖拽排序。</p>
            <p style={{ margin: '4px 0' }}>在文件/文件夹行点击「添加」按钮，可为其打上多个标签。</p>

            <h4 style={{ margin: '12px 0 8px' }}>3. 标签搜索</h4>
            <p style={{ margin: '4px 0' }}>点击「标签搜索」按标签筛选文件与文件夹，可多选标签组合。</p>
            <p style={{ margin: '4px 0' }}>搜索结果右侧可「打开文件」、「打开所在目录」（调用系统资源管理器）。</p>

            <h4 style={{ margin: '12px 0 8px' }}>4. 同步与重映射</h4>
            <p style={{ margin: '4px 0' }}>浏览页顶部「同步标签」按钮会扫描当前目录：</p>
            <p style={{ margin: '4px 0' }}>- 文件按 sha256 匹配，命中后自动复制历史标签</p>
            <p style={{ margin: '4px 0' }}>- 文件夹读取 <code>&lt;uuid&gt;.tag</code> 文件，匹配历史同源文件夹并复制标签</p>

            <h4 style={{ margin: '12px 0 8px' }}>5. 数据存储</h4>
            <p style={{ margin: '4px 0' }}>tags.db 存放在 exe 同级目录，便于备份与迁移。</p>
          </div>
        </Modal>

        <Modal
          title="确认删除"
          open={deleteTagId !== null}
          onOk={confirmDeleteTag}
          onCancel={() => setDeleteTagId(null)}
          okText="删除"
          cancelText="取消"
        >
          <p>确定要删除这个标签吗？删除后，<span style={{ color: '#ff4d4f' }}>使用该标签的文件将失去此标签</span>。</p>
        </Modal>
      </Layout>
    </Layout>
  );
}