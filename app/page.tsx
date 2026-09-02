'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type Task = { id: number; title: string; course: string; due: string; done: boolean; notes: string; gradeCategory: string; score: number | null };
type GradeCategory = { name: string; weight: number; kind: 'exam' | 'task'; score: number | null };
type Course = { name: string; grading: GradeCategory[] };
type GradeRow = { id: number; name: string; weight: string; kind: 'exam' | 'task' };
type WeeklyItem = { id: number; weekday: number; title: string; time: string; kind: '课程' | '任务' };
type Forecast = { target: number; scores: Record<string, number> };
type DataBundle = { format: 'deadline-tracker'; version: 1; savedAt: string; tasks: Task[]; courses: Course[]; weeklyCourses: WeeklyItem[]; weeklyAssignments: WeeklyItem[]; forecasts: Record<string, Forecast> };
type LocalWritableFile = { write(data: string): Promise<void>; close(): Promise<void> };
type LocalFileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritableFile>;
  queryPermission?(descriptor?: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor?: { mode: 'readwrite' }): Promise<PermissionState>;
};
type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: { suggestedName?: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<LocalFileHandle>;
  showOpenFilePicker?: (options?: { multiple?: boolean; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<LocalFileHandle[]>;
};

const FILE_HANDLE_DB = 'deadline-tracker-file';
const FILE_HANDLE_STORE = 'handles';
const FILE_HANDLE_KEY = 'primary-data-file';
const jsonPickerOptions = { types: [{ description: 'Deadline Tracker 数据', accept: { 'application/json': ['.json'] } }] };

function openFileHandleDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILE_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_HANDLE_STORE)) request.result.createObjectStore(FILE_HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberFileHandle(handle: LocalFileHandle) {
  const db = await openFileHandleDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(FILE_HANDLE_STORE, 'readwrite');
    transaction.objectStore(FILE_HANDLE_STORE).put(handle, FILE_HANDLE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function recallFileHandle() {
  const db = await openFileHandleDb();
  const handle = await new Promise<LocalFileHandle | null>((resolve, reject) => {
    const request = db.transaction(FILE_HANDLE_STORE, 'readonly').objectStore(FILE_HANDLE_STORE).get(FILE_HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as LocalFileHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

async function writeDataFile(handle: LocalFileHandle, bundle: DataBundle) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(bundle, null, 2));
  await writable.close();
}

async function readDataFile(handle: LocalFileHandle) {
  const file = await handle.getFile();
  if (!file.size) return null;
  const raw = JSON.parse(await file.text()) as Partial<DataBundle>;
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.courses)) throw new Error('这不是有效的 Deadline Tracker 数据文件。');
  return {
    format: 'deadline-tracker',
    version: 1,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
    tasks: raw.tasks.map((task) => ({ ...task, due: task.due.includes('T') ? task.due : `${task.due}T23:59`, notes: task.notes ?? '', gradeCategory: task.gradeCategory ?? '', score: typeof task.score === 'number' ? task.score : null })),
    courses: raw.courses.map((course) => ({ name: course.name, grading: Array.isArray(course.grading) ? course.grading.map((category) => ({ ...category, kind: category.kind === 'exam' ? 'exam' as const : 'task' as const, score: typeof category.score === 'number' ? category.score : null })) : [] })),
    weeklyCourses: Array.isArray(raw.weeklyCourses) ? raw.weeklyCourses : [],
    weeklyAssignments: Array.isArray(raw.weeklyAssignments) ? raw.weeklyAssignments : [],
    forecasts: raw.forecasts && typeof raw.forecasts === 'object' ? raw.forecasts : {},
  } satisfies DataBundle;
}

const seed: Task[] = [
  { id: 1, title: 'Problem Set 3', course: 'EECS 280', due: '2026-09-02T23:59', done: false, notes: '完成第 5–12 题，提交 PDF，并检查代码风格。', gradeCategory: '', score: null },
  { id: 2, title: 'Reading response', course: 'English 325', due: '2026-09-04T17:00', done: false, notes: '围绕本周阅读材料写 500 字回应。', gradeCategory: '', score: null },
  { id: 3, title: 'Lab report', course: 'Chemistry 130', due: '2026-09-07T14:30', done: false, notes: '附上实验数据表和误差分析。', gradeCategory: '', score: null },
  { id: 4, title: 'Chapter 2 notes', course: 'Math 214', due: '2026-09-10T09:00', done: true, notes: '', gradeCategory: '', score: null },
];
const seedCourses: Course[] = [...new Set(seed.map((task) => task.course))].map((name) => ({ name, grading: [] }));
const UNASSIGNED = '未分类';
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date));
const blankGradeRows = (): GradeRow[] => [{ id: Date.now(), name: '', weight: '', kind: 'task' }, { id: Date.now() + 1, name: '', weight: '', kind: 'task' }];
const taskCategoriesFor = (course: Course | undefined) => (course?.grading ?? []).filter((category) => category.kind === 'task');

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>(seed);
  const [courses, setCourses] = useState<Course[]>(seedCourses);
  const [storageReady, setStorageReady] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [fileHandle, setFileHandle] = useState<LocalFileHandle | null>(null);
  const [fileReady, setFileReady] = useState(false);
  const [fileStatus, setFileStatus] = useState('尚未连接本地数据文件');
  const [fileStatusKind, setFileStatusKind] = useState<'idle' | 'saving' | 'saved' | 'warning' | 'error'>('idle');
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('全部');
  const [categoryFilter, setCategoryFilter] = useState('全部类别');
  const [formOpen, setFormOpen] = useState(false);
  const [batchFormOpen, setBatchFormOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<'course' | 'task'>('course');
  const [calendarFormOpen, setCalendarFormOpen] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<{ weekday: string; title: string; time: string; kind: '课程' | '任务' }>({ weekday: '1', title: '', time: '', kind: '课程' });
  const [weeklyCourses, setWeeklyCourses] = useState<WeeklyItem[]>([]);
  const [weeklyAssignments, setWeeklyAssignments] = useState<WeeklyItem[]>([]);
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([{ id: 1, name: '', weight: '', kind: 'task' }, { id: 2, name: '', weight: '', kind: 'task' }]);
  const [gradeError, setGradeError] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<{ title: string; course: string; due: string; notes: string; gradeCategory: string; score: string }>({ title: '', course: seedCourses[0].name, due: '2026-09-01T23:59', notes: '', gradeCategory: '', score: '' });
  const [batchDraft, setBatchDraft] = useState({ title: 'Weekly Assignment', course: seedCourses[0].name, gradeCategory: '', weekday: '1', dueTime: '23:59', startDate: '2026-09-01', endDate: '2026-12-18', notes: '' });
  const dataBundle = useMemo<DataBundle>(() => ({ format: 'deadline-tracker', version: 1, savedAt: new Date().toISOString(), tasks, courses, weeklyCourses, weeklyAssignments, forecasts }), [tasks, courses, weeklyCourses, weeklyAssignments, forecasts]);

  useEffect(() => {
    let loadedTasks = seed;
    const savedTasks = localStorage.getItem('deadline-tasks');
    if (savedTasks) {
      try {
        loadedTasks = (JSON.parse(savedTasks) as Array<Omit<Task, 'notes' | 'gradeCategory' | 'score'> & { notes?: string; gradeCategory?: string; score?: number | null }>).map((task) => ({ ...task, due: task.due.includes('T') ? task.due : `${task.due}T23:59`, notes: task.notes ?? '', gradeCategory: task.gradeCategory ?? '', score: typeof task.score === 'number' ? task.score : null }));
      } catch { /* Keep the starter list if saved data is invalid. */ }
    }
    setTasks(loadedTasks);

    let loadedCourses: Course[] = [];
    const savedCourses = localStorage.getItem('deadline-courses');
    if (savedCourses) {
      try {
        loadedCourses = (JSON.parse(savedCourses) as Array<string | Course>).map((course) => typeof course === 'string'
          ? { name: course, grading: [] }
          : { name: course.name, grading: Array.isArray(course.grading) ? course.grading.map((category) => ({ ...category, kind: category.kind === 'exam' ? 'exam' : 'task', score: typeof category.score === 'number' ? category.score : null })) : [] });
      } catch { /* Rebuild courses from assignments below. */ }
    }
    for (const name of loadedTasks.map((task) => task.course)) {
      if (name && !loadedCourses.some((course) => course.name === name)) loadedCourses.push({ name, grading: [] });
    }
    setCourses(loadedCourses);
    setDraft((current) => ({ ...current, course: loadedCourses[0]?.name ?? '' }));
    setBatchDraft((current) => ({ ...current, course: loadedCourses[0]?.name ?? '' }));
    try { setWeeklyCourses(JSON.parse(localStorage.getItem('deadline-weekly-courses') ?? '[]')); } catch { /* Start with an empty weekly course schedule. */ }
    try { setWeeklyAssignments(JSON.parse(localStorage.getItem('deadline-weekly-assignments') ?? '[]')); } catch { /* Start with an empty weekly assignment schedule. */ }
    try { setForecasts(JSON.parse(localStorage.getItem('deadline-grade-forecasts') ?? '{}')); } catch { /* Start with fresh grade forecasts. */ }
    setStorageReady(true);
  }, []);

  useEffect(() => { if (storageReady) localStorage.setItem('deadline-tasks', JSON.stringify(tasks)); }, [tasks, storageReady]);
  useEffect(() => { if (storageReady) localStorage.setItem('deadline-courses', JSON.stringify(courses)); }, [courses, storageReady]);
  useEffect(() => { if (storageReady) localStorage.setItem('deadline-weekly-courses', JSON.stringify(weeklyCourses)); }, [weeklyCourses, storageReady]);
  useEffect(() => { if (storageReady) localStorage.setItem('deadline-weekly-assignments', JSON.stringify(weeklyAssignments)); }, [weeklyAssignments, storageReady]);
  useEffect(() => { if (storageReady) localStorage.setItem('deadline-grade-forecasts', JSON.stringify(forecasts)); }, [forecasts, storageReady]);

  useEffect(() => {
    if (!storageReady || !('indexedDB' in window)) return;
    let cancelled = false;
    void recallFileHandle().then(async (handle) => {
      if (!handle || cancelled) return;
      setFileHandle(handle);
      const permission = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'prompt';
      if (cancelled) return;
      if (permission !== 'granted') {
        setFileStatus(`${handle.name} 需要重新授权`);
        setFileStatusKind('warning');
        return;
      }
      const bundle = await readDataFile(handle);
      if (cancelled) return;
      if (bundle) applyDataBundle(bundle);
      setFileReady(true);
      setFileStatus(`已连接 ${handle.name}`);
      setFileStatusKind('saved');
    }).catch(() => {
      if (!cancelled) {
        setFileStatus('无法恢复上次连接，请重新选择文件');
        setFileStatusKind('warning');
      }
    });
    return () => { cancelled = true; };
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady || !fileHandle || !fileReady) return;
    const timer = window.setTimeout(() => {
      setFileStatus('正在保存到本地文件…');
      setFileStatusKind('saving');
      void writeDataFile(fileHandle, dataBundle).then(() => {
        setFileStatus(`已自动保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
        setFileStatusKind('saved');
      }).catch(() => {
        setFileReady(false);
        setFileStatus('自动保存失败，请重新授权');
        setFileStatusKind('error');
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dataBundle, fileHandle, fileReady, storageReady]);

  function applyDataBundle(bundle: DataBundle) {
    setTasks(bundle.tasks);
    setCourses(bundle.courses);
    setWeeklyCourses(bundle.weeklyCourses);
    setWeeklyAssignments(bundle.weeklyAssignments);
    setForecasts(bundle.forecasts);
    setSelectedTask(null);
    setFilter('全部');
    setCategoryFilter('全部类别');
    setDraft((current) => ({ ...current, course: bundle.courses[0]?.name ?? '' }));
    setBatchDraft((current) => ({ ...current, course: bundle.courses[0]?.name ?? '' }));
  }

  function pickerWindow() {
    return window as unknown as FilePickerWindow;
  }

  async function connectAndSaveFile() {
    const picker = pickerWindow();
    if (!picker.showSaveFilePicker) {
      setFileStatus('当前浏览器不支持直接写入文件，请使用导出备份');
      setFileStatusKind('warning');
      return;
    }
    try {
      const handle = await picker.showSaveFilePicker({ suggestedName: 'assignment-tracker-data.json', ...jsonPickerOptions });
      await writeDataFile(handle, dataBundle);
      await rememberFileHandle(handle);
      setFileHandle(handle);
      setFileReady(true);
      setFileStatus(`已连接 ${handle.name}`);
      setFileStatusKind('saved');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFileStatus('连接文件失败，请重试');
        setFileStatusKind('error');
      }
    }
  }

  async function restoreFromLocalFile() {
    const picker = pickerWindow();
    if (!picker.showOpenFilePicker) {
      backupInputRef.current?.click();
      return;
    }
    try {
      const [handle] = await picker.showOpenFilePicker({ multiple: false, ...jsonPickerOptions });
      if (!handle) return;
      const bundle = await readDataFile(handle);
      if (!bundle) throw new Error('数据文件为空。');
      const permission = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : 'prompt';
      applyDataBundle(bundle);
      setFileHandle(handle);
      setFileReady(permission === 'granted');
      if (permission === 'granted') await rememberFileHandle(handle);
      setFileStatus(permission === 'granted' ? `已恢复并连接 ${handle.name}` : `已恢复 ${handle.name}，但没有自动保存权限`);
      setFileStatusKind(permission === 'granted' ? 'saved' : 'warning');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setFileStatus(error instanceof Error ? error.message : '读取数据文件失败');
        setFileStatusKind('error');
      }
    }
  }

  async function reauthorizeFile() {
    if (!fileHandle) return;
    try {
      const permission = fileHandle.requestPermission ? await fileHandle.requestPermission({ mode: 'readwrite' }) : 'prompt';
      if (permission !== 'granted') {
        setFileStatus('没有获得文件读写权限');
        setFileStatusKind('warning');
        return;
      }
      const bundle = await readDataFile(fileHandle);
      if (bundle) applyDataBundle(bundle);
      await rememberFileHandle(fileHandle);
      setFileReady(true);
      setFileStatus(`已重新连接 ${fileHandle.name}`);
      setFileStatusKind('saved');
    } catch {
      setFileStatus('重新授权失败，请重新选择文件');
      setFileStatusKind('error');
    }
  }

  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(dataBundle, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `assignment-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setFileStatus('备份文件已导出');
    setFileStatusKind('saved');
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<DataBundle>;
      if (!Array.isArray(raw.tasks) || !Array.isArray(raw.courses)) throw new Error('这不是有效的 Deadline Tracker 备份。');
      const bundle = await readDataFile({ name: file.name, getFile: async () => file, createWritable: async () => { throw new Error('只读文件'); } });
      if (!bundle) throw new Error('备份文件为空。');
      applyDataBundle(bundle);
      setFileStatus(`已导入 ${file.name}；连接数据文件后可自动保存`);
      setFileStatusKind('warning');
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : '导入备份失败');
      setFileStatusKind('error');
    }
  }

  const active = tasks.filter((task) => !task.done);
  const shown = tasks
    .filter((task) => (filter === '全部' || (filter === '待完成' ? !task.done : task.course === filter)) && (categoryFilter === '全部类别' || task.gradeCategory === categoryFilter))
    .sort((a, b) => a.due.localeCompare(b.due));
  const now = Date.now();
  const urgent = active.filter((task) => { const due = new Date(task.due).getTime(); return due >= now && due <= now + 24 * 60 * 60 * 1000; }).sort((a, b) => a.due.localeCompare(b.due));
  const categoryFilters = [...new Set(tasks.map((task) => task.gradeCategory).filter(Boolean))];
  const soon = active.filter((task) => { const due = new Date(task.due).getTime(); return due >= now && due <= now + 7 * 24 * 60 * 60 * 1000; }).length;
  const stats = useMemo(() => ({ total: active.length, soon }), [active.length, soon]);

  function openTaskForm() {
    if (!courses.length) { openCourseForm(); return; }
    setDraft((current) => {
      const courseName = courses.some((course) => course.name === current.course) ? current.course : courses[0].name;
      const categories = taskCategoriesFor(courses.find((course) => course.name === courseName));
      return { ...current, course: courseName, gradeCategory: categories.some((item) => item.name === current.gradeCategory) ? current.gradeCategory : (categories[0]?.name ?? '') };
    });
    setFormOpen(true);
  }

  function changeDraftCourse(courseName: string) {
    const categories = taskCategoriesFor(courses.find((course) => course.name === courseName));
    setDraft({ ...draft, course: courseName, gradeCategory: categories[0]?.name ?? '' });
  }

  function openCourseForm() {
    setEditingCourse(null);
    setCourseName('');
    setGradeRows(blankGradeRows());
    setGradeError('');
    setCourseFormOpen(true);
  }

  function closeCourseForm() {
    setCourseFormOpen(false);
    setEditingCourse(null);
    setCourseName('');
    setGradeRows(blankGradeRows());
    setGradeError('');
  }

  function editCourse(course: Course) {
    setEditingCourse(course.name);
    setCourseName(course.name);
    setGradeRows(course.grading.length
      ? course.grading.map((item, index) => ({ id: Date.now() + index, name: item.name, weight: String(item.weight), kind: item.kind }))
      : blankGradeRows());
    setGradeError('');
    setCourseFormOpen(true);
  }

  function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.course) return;
    const course = courses.find((item) => item.name === draft.course);
    if (taskCategoriesFor(course).length && !draft.gradeCategory) return;
    setTasks([{ ...draft, title: draft.title.trim(), notes: draft.notes.trim(), score: draft.score === '' ? null : Number(draft.score), id: Date.now(), done: false }, ...tasks]);
    setDraft({ title: '', course: draft.course, due: '2026-09-01T23:59', notes: '', gradeCategory: draft.gradeCategory, score: '' });
    setFormOpen(false);
  }

  function saveCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = courseName.trim();
    if (!name) return;
    const usedRows = gradeRows.filter((row) => row.name.trim() || row.weight.trim());
    if (usedRows.some((row) => !row.name.trim() || !row.weight.trim() || Number(row.weight) <= 0)) {
      setGradeError('每个评分项目都需要名称和大于 0 的百分比。');
      return;
    }
    const previous = editingCourse ? courses.find((course) => course.name === editingCourse) : undefined;
    const grading = usedRows.map((row, index) => ({ name: row.name.trim(), weight: Number(row.weight), kind: row.kind, score: previous?.grading[index]?.kind === row.kind ? previous.grading[index].score : null }));
    const total = grading.reduce((sum, item) => sum + item.weight, 0);
    if (grading.length && Math.abs(total - 100) > 0.001) {
      setGradeError(`评分比例当前合计 ${total}%，需要正好为 100%。`);
      return;
    }
    if (editingCourse) {
      const categoryUpdates = new Map(previous?.grading.map((item, index) => [item.name, grading[index]]) ?? []);
      setTasks(tasks.map((task) => task.course === editingCourse && task.gradeCategory && categoryUpdates.has(task.gradeCategory)
        ? { ...task, gradeCategory: categoryUpdates.get(task.gradeCategory)?.kind === 'task' ? categoryUpdates.get(task.gradeCategory)?.name ?? '' : '' }
        : task));
      setCourses(courses.map((course) => course.name === editingCourse ? { ...course, grading } : course));
      closeCourseForm();
      return;
    }
    const existing = courses.find((course) => course.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      setGradeError('这个课程已经存在，可以在下方选择“编辑评分”。');
      return;
    }
    setCourses([...courses, { name, grading }]);
    setDraft((current) => ({ ...current, course: name }));
    setFilter(name);
    closeCourseForm();
  }

  function deleteCourse(course: string) {
    if (course === UNASSIGNED) return;
    const affected = tasks.filter((task) => task.course === course).length;
    const message = affected
      ? `删除“${course}”吗？其中 ${affected} 项作业会保留并移到“${UNASSIGNED}”。`
      : `删除“${course}”吗？`;
    if (!window.confirm(message)) return;
    const remaining = courses.filter((item) => item.name !== course);
    const nextCourses = affected && !remaining.some((item) => item.name === UNASSIGNED) ? [...remaining, { name: UNASSIGNED, grading: [] }] : remaining;
    if (affected) setTasks(tasks.map((task) => task.course === course ? { ...task, course: UNASSIGNED, gradeCategory: '' } : task));
    setCourses(nextCourses);
    setFilter(affected ? UNASSIGNED : '全部');
    setDraft((current) => ({ ...current, course: current.course === course ? (nextCourses[0]?.name ?? '') : current.course }));
  }

  function saveSelectedTaskGrade() {
    if (!selectedTask) return;
    setTasks(tasks.map((task) => task.id === selectedTask.id ? selectedTask : task));
  }

  function setExamScore(courseName: string, categoryName: string, value: string) {
    const score = value === '' ? null : Number(value);
    setCourses(courses.map((course) => course.name === courseName
      ? { ...course, grading: course.grading.map((category) => category.name === categoryName ? { ...category, score } : category) }
      : course));
  }

  function openBatchForm() {
    if (!courses.length) { openCourseForm(); return; }
    setBatchDraft((current) => {
      const courseName = courses.some((course) => course.name === current.course) ? current.course : courses[0].name;
      const categories = taskCategoriesFor(courses.find((course) => course.name === courseName));
      return { ...current, course: courseName, gradeCategory: categories.some((item) => item.name === current.gradeCategory) ? current.gradeCategory : (categories[0]?.name ?? '') };
    });
    setBatchFormOpen(true);
  }

  function changeBatchCourse(courseName: string) {
    const categories = taskCategoriesFor(courses.find((course) => course.name === courseName));
    setBatchDraft({ ...batchDraft, course: courseName, gradeCategory: categories[0]?.name ?? '' });
  }

  function saveBatchTasks(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batchDraft.title.trim() || !batchDraft.course || batchDraft.endDate < batchDraft.startDate) return;
    const course = courses.find((item) => item.name === batchDraft.course);
    if (taskCategoriesFor(course).length && !batchDraft.gradeCategory) return;
    const cursor = new Date(`${batchDraft.startDate}T12:00`);
    const end = new Date(`${batchDraft.endDate}T12:00`);
    const additions: Task[] = [];
    while (cursor <= end) {
      if (cursor.getDay() === Number(batchDraft.weekday)) {
        const date = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
        additions.push({ id: Date.now() + additions.length, title: batchDraft.title.trim(), course: batchDraft.course, due: `${date}T${batchDraft.dueTime}`, done: false, notes: batchDraft.notes.trim(), gradeCategory: batchDraft.gradeCategory, score: null });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!additions.length) return;
    setTasks([...additions, ...tasks]);
    setBatchFormOpen(false);
  }

  function openCalendarForm(weekday: number) {
    setCalendarDraft({ weekday: String(weekday), title: '', time: '', kind: calendarMode === 'course' ? '课程' : '任务' });
    setCalendarFormOpen(true);
  }

  function saveCalendarItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarDraft.title.trim()) return;
    const item: WeeklyItem = { id: Date.now(), weekday: Number(calendarDraft.weekday), title: calendarDraft.title.trim(), time: calendarDraft.time, kind: calendarMode === 'course' ? calendarDraft.kind : '任务' };
    if (calendarMode === 'course') setWeeklyCourses([...weeklyCourses, item]);
    else setWeeklyAssignments([...weeklyAssignments, item]);
    setCalendarFormOpen(false);
  }

  function deleteCalendarItem(id: number) {
    if (calendarMode === 'course') setWeeklyCourses(weeklyCourses.filter((item) => item.id !== id));
    else setWeeklyAssignments(weeklyAssignments.filter((item) => item.id !== id));
  }

  function updateForecast(courseName: string, update: (forecast: Forecast) => Forecast) {
    setForecasts((current) => {
      const forecast = current[courseName] ?? { target: 90, scores: {} };
      return { ...current, [courseName]: update(forecast) };
    });
  }

  const gradeTotal = gradeRows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
  const selectedCourse = courses.find((course) => course.name === filter);
  const categoryStats = (selectedCourse?.grading ?? []).map((category) => {
    if (category.kind === 'exam') return { ...category, average: category.score, gradedCount: category.score === null ? 0 : 1 };
    const graded = tasks.filter((task) => task.course === selectedCourse?.name && task.gradeCategory === category.name && task.score !== null);
    const average = graded.length ? graded.reduce((sum, task) => sum + (task.score ?? 0), 0) / graded.length : null;
    return { ...category, average, gradedCount: graded.length };
  });
  const gradedWeight = categoryStats.filter((item) => item.average !== null).reduce((sum, item) => sum + item.weight, 0);
  const currentCourseGrade = gradedWeight
    ? categoryStats.reduce((sum, item) => sum + (item.average ?? 0) * item.weight, 0) / gradedWeight
    : null;
  const selectedTaskCourse = selectedTask ? courses.find((course) => course.name === selectedTask.course) : undefined;
  const forecast = selectedCourse ? forecasts[selectedCourse.name] ?? { target: 90, scores: {} } : { target: 90, scores: {} };
  const forecastItems = (selectedCourse?.grading ?? []).flatMap((category) => {
    if (category.kind === 'exam') return category.score === null ? [{ key: `exam-${category.name}`, label: category.name, description: `考试 · ${category.weight}%`, score: forecast.scores[`exam-${category.name}`] ?? 80 }] : [];
    return tasks.filter((task) => task.course === selectedCourse?.name && task.gradeCategory === category.name && task.score === null)
      .map((task) => ({ key: `task-${task.id}`, label: task.title, description: `${category.name} · 任务`, score: forecast.scores[`task-${task.id}`] ?? 80 }));
  });
  const projectedFinal = selectedCourse?.grading.reduce((total, category) => {
    if (category.kind === 'exam') return total + (category.score ?? forecast.scores[`exam-${category.name}`] ?? 0) * category.weight / 100;
    const categoryTasks = tasks.filter((task) => task.course === selectedCourse.name && task.gradeCategory === category.name);
    if (!categoryTasks.length) return total;
    const average = categoryTasks.reduce((sum, task) => sum + (task.score ?? forecast.scores[`task-${task.id}`] ?? 0), 0) / categoryTasks.length;
    return total + average * category.weight / 100;
  }, 0) ?? null;
  const weekDays = [{ label: '周一', value: 1 }, { label: '周二', value: 2 }, { label: '周三', value: 3 }, { label: '周四', value: 4 }, { label: '周五', value: 5 }, { label: '周六', value: 6 }, { label: '周日', value: 0 }];
  const calendarItems = calendarMode === 'course' ? weeklyCourses : weeklyAssignments;
  const today = new Date().getDay();

  return <main>
    <header>
      <div className="brand"><span className="mark">D</span><span>deadline</span></div>
      <div className="date">2026 年 8 月 31 日 · 星期一</div>
      <div className="header-actions">
        <div className="data-menu">
          <button type="button" className={`data-menu-trigger ${fileReady ? 'connected' : ''}`} aria-expanded={dataMenuOpen} aria-controls="local-data-panel" onClick={() => setDataMenuOpen(!dataMenuOpen)}>数据<span aria-hidden="true">{dataMenuOpen ? '▴' : '▾'}</span></button>
          {dataMenuOpen && <section id="local-data-panel" className="data-menu-panel" aria-label="本地数据管理">
            <div className={`data-file-status ${fileStatusKind}`} aria-live="polite"><span aria-hidden="true" /><div><strong>{fileReady ? '本地文件已连接' : '本地数据文件'}</strong><p>{fileStatus}</p></div></div>
            <div className="data-menu-actions">
              {fileHandle && !fileReady && <button type="button" className="data-action primary" onClick={reauthorizeFile}>重新授权并读取</button>}
              <button type="button" className="data-action" onClick={connectAndSaveFile}>连接并保存当前数据</button>
              <button type="button" className="data-action" onClick={restoreFromLocalFile}>从本地文件恢复</button>
            </div>
            <div className="data-backup-actions"><button type="button" onClick={exportBackup}>导出备份</button><button type="button" onClick={() => backupInputRef.current?.click()}>导入备份</button></div>
            <input ref={backupInputRef} className="data-file-input" type="file" accept="application/json,.json" onChange={importBackup} />
            <small>清除浏览器记录不会删除电脑上的数据文件；之后重新选择同一文件即可恢复。</small>
          </section>}
        </div>
        <button className="secondary" onClick={openCourseForm}>＋ 添加课程</button><button className="secondary" onClick={openBatchForm}>＋ 批量添加</button><button className="add" onClick={openTaskForm}>＋ 添加作业</button>
      </div>
    </header>
    <section className="overview-grid"><div className="overview-left"><section className="urgent-panel"><div><p className="eyebrow">24 小时内</p><h2>即将到期</h2></div>{urgent.length ? <div className="urgent-list">{urgent.map((task) => <button key={task.id} className="urgent-item" onClick={() => setSelectedTask(task)}><span>{task.title}</span><small>{formatDate(task.due)}</small></button>)}</div> : <p className="urgent-empty">未来 24 小时没有截止事项。</p>}</section><section className="metrics"><article><span>待完成</span><strong>{stats.total}</strong><small>项作业</small></article><article className="accent"><span>未来 7 天</span><strong>{stats.soon}</strong><small>项需要关注</small></article></section></div><section className="calendar-panel" aria-label="每周日历"><div className="calendar-head"><p className="eyebrow">日历</p><div className="calendar-tabs"><button className={calendarMode === 'course' ? 'selected' : ''} onClick={() => setCalendarMode('course')}>每周课程</button><button className={calendarMode === 'task' ? 'selected' : ''} onClick={() => setCalendarMode('task')}>每周作业</button></div></div><div className="week-grid">{weekDays.map((day) => <section className={`week-day ${today === day.value ? 'today' : ''}`} key={day.value}><div className="week-day-head"><span>{day.label}</span>{today === day.value && <small>今天</small>}</div><div className="week-items">{calendarItems.filter((item) => item.weekday === day.value).map((item) => <div className="week-item" key={item.id}><button onClick={() => deleteCalendarItem(item.id)} aria-label={`删除 ${item.title}`} title="删除">×</button>{item.time && <small>{item.time}</small>}<span>{item.title}</span>{calendarMode === 'course' && <em>{item.kind}</em>}</div>)}</div><button className="week-add" onClick={() => openCalendarForm(day.value)}>＋</button></section>)}</div></section></section>
    <section className="workspace">
      <aside><div className="aside-title"><p>筛选</p><button onClick={openCourseForm}>＋ 课程</button></div><button className={filter === '全部' ? 'selected' : ''} onClick={() => setFilter('全部')}>全部<span>{tasks.length}</span></button><button className={filter === '待完成' ? 'selected' : ''} onClick={() => setFilter('待完成')}>待完成<span>{active.length}</span></button>{courses.map((course) => <div className="course-nav-row" key={course.name}><button className={filter === course.name ? 'selected' : ''} onClick={() => setFilter(course.name)}>{course.name}<span>{tasks.filter((task) => task.course === course.name).length}</span></button>{course.name !== UNASSIGNED && <button className="course-settings" aria-label={`设置 ${course.name}`} title={`设置 ${course.name}`} onClick={() => editCourse(course)}>⚙</button>}</div>)}</aside>
      <div className="list"><div className="list-head"><div><p className="eyebrow">作业清单</p><h2>{filter}</h2></div><span>{shown.length} 项</span></div>
      <div className="category-filters"><button className={categoryFilter === '全部类别' ? 'selected' : ''} onClick={() => setCategoryFilter('全部类别')}>全部类别</button>{categoryFilters.map((category) => <button key={category} className={categoryFilter === category ? 'selected' : ''} onClick={() => setCategoryFilter(category)}>{category}</button>)}</div>
      {selectedCourse && selectedCourse.grading.length > 0 && <><section className="course-grade-panel"><div className="course-grade-total"><span>当前课程成绩</span><strong>{currentCourseGrade === null ? '—' : `${currentCourseGrade.toFixed(1)}%`}</strong><small>按已有成绩计算</small></div><div className="category-averages">{categoryStats.map((category) => <div key={category.name}><span>{category.name}<small>{category.kind === 'exam' ? '考试' : '任务'} · {category.weight}% · {category.gradedCount} 项已评分</small></span>{category.kind === 'exam' ? <div className="exam-score"><input aria-label={`${category.name} 考试成绩`} type="number" min="0" max="100" step="0.1" value={category.score ?? ''} onChange={(event) => setExamScore(selectedCourse.name, category.name, event.target.value)} placeholder="输入成绩" /><span>%</span></div> : <strong>{category.average === null ? '—' : `${category.average.toFixed(1)}%`}</strong>}</div>)}</div></section><section className="grade-planner"><div className="planner-heading"><div><p className="eyebrow">成绩预测</p><h3>目标最终分数</h3></div><div className="target-score"><input aria-label="目标最终分数" type="range" min="0" max="100" step="0.1" value={forecast.target} onChange={(event) => updateForecast(selectedCourse.name, (current) => ({ ...current, target: Number(event.target.value) }))} /><strong>{forecast.target.toFixed(1)}%</strong></div></div><div className="planner-summary"><span>按预测计算</span><strong>{projectedFinal === null ? '—' : `${projectedFinal.toFixed(1)}%`}</strong><small className={projectedFinal !== null && projectedFinal >= forecast.target ? 'on-track' : ''}>{projectedFinal !== null && projectedFinal >= forecast.target ? '预计达到目标' : '还需要提升预测分数'}</small></div>{forecastItems.length ? <div className="forecast-items">{forecastItems.map((item) => <label key={item.key}><span><strong>{item.label}</strong><small>{item.description}</small></span><input aria-label={`${item.label} 预测成绩`} type="range" min="0" max="100" step="0.1" value={item.score} onChange={(event) => updateForecast(selectedCourse.name, (current) => ({ ...current, scores: { ...current.scores, [item.key]: Number(event.target.value) } }))} /><output>{item.score.toFixed(1)}%</output></label>)}</div> : <p className="planner-empty">没有等待评分的考试或作业；添加项目后可在这里预测成绩。</p>}</section></>}
      {shown.length ? shown.map((task) => <article className={`task ${task.done ? 'done' : ''}`} key={task.id}>
        <button className="check" aria-label={`标记 ${task.title} 完成`} onClick={() => setTasks(tasks.map((item) => item.id === task.id ? { ...item, done: !item.done } : item))}>{task.done && '✓'}</button>
        <button className="task-open" onClick={() => setSelectedTask(task)}><h3>{task.title}</h3><p>{task.course}{task.gradeCategory && <><b>·</b><span className="grade-category">{task.gradeCategory}</span></>} <b>·</b> {formatDate(task.due)}{task.score !== null && <><b>·</b><span className="task-score">{task.score}%</span></>}{task.notes && <><b>·</b><span className="has-notes">有备注</span></>}</p></button>
        <button className="delete" aria-label={`删除 ${task.title}`} onClick={() => setTasks(tasks.filter((item) => item.id !== task.id))}>×</button>
      </article>) : <div className="empty">这个分类还没有作业。</div>}</div>
    </section>

    {formOpen && <div className="modal-backdrop" onMouseDown={() => setFormOpen(false)}><form className="modal" onSubmit={saveTask} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">新的截止日期</p><h2>添加作业</h2></div>
      <label>作业名称<input autoFocus required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：Group Assignment" /></label>
      <div className="row"><label>课程<select required value={draft.course} onChange={(event) => changeDraftCourse(event.target.value)}>{courses.map((course) => <option key={course.name}>{course.name}</option>)}</select></label><label>任务类别<select required={Boolean(taskCategoriesFor(courses.find((course) => course.name === draft.course)).length)} disabled={!taskCategoriesFor(courses.find((course) => course.name === draft.course)).length} value={draft.gradeCategory} onChange={(event) => setDraft({ ...draft, gradeCategory: event.target.value })}>{taskCategoriesFor(courses.find((course) => course.name === draft.course)).length ? taskCategoriesFor(courses.find((course) => course.name === draft.course)).map((category) => <option key={category.name}>{category.name}</option>) : <option value="">没有任务类别</option>}</select></label></div>
      <label>截止日期与时间<input type="datetime-local" required value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} /></label>
      <label>成绩（可稍后填写）<div className="score-input"><input type="number" min="0" max="100" step="0.01" value={draft.score} onChange={(event) => setDraft({ ...draft, score: event.target.value })} placeholder="例如：92" /><span>%</span></div></label>
      <label>备注<textarea rows={5} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="补充要求、提交方式、参考资料或需要记住的事项……" /></label>
      <div className="actions"><button type="button" className="plain" onClick={() => setFormOpen(false)}>取消</button><button className="add">保存作业</button></div>
    </form></div>}

    {batchFormOpen && <div className="modal-backdrop" onMouseDown={() => setBatchFormOpen(false)}><form className="modal batch-modal" onSubmit={saveBatchTasks} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">重复安排</p><h2>批量添加作业</h2><p className="modal-copy">在选定的起止日期之间，每周自动创建一项同名作业。</p></div>
      <label>作业名称<input autoFocus required value={batchDraft.title} onChange={(event) => setBatchDraft({ ...batchDraft, title: event.target.value })} placeholder="例如：Weekly Assignment" /></label>
      <div className="row"><label>课程<select required value={batchDraft.course} onChange={(event) => changeBatchCourse(event.target.value)}>{courses.map((course) => <option key={course.name}>{course.name}</option>)}</select></label><label>任务类别<select required={Boolean(taskCategoriesFor(courses.find((course) => course.name === batchDraft.course)).length)} disabled={!taskCategoriesFor(courses.find((course) => course.name === batchDraft.course)).length} value={batchDraft.gradeCategory} onChange={(event) => setBatchDraft({ ...batchDraft, gradeCategory: event.target.value })}>{taskCategoriesFor(courses.find((course) => course.name === batchDraft.course)).length ? taskCategoriesFor(courses.find((course) => course.name === batchDraft.course)).map((category) => <option key={category.name}>{category.name}</option>) : <option value="">没有任务类别</option>}</select></label></div>
      <div className="row"><label>每周哪一天到期<select value={batchDraft.weekday} onChange={(event) => setBatchDraft({ ...batchDraft, weekday: event.target.value })}><option value="1">星期一</option><option value="2">星期二</option><option value="3">星期三</option><option value="4">星期四</option><option value="5">星期五</option><option value="6">星期六</option><option value="0">星期日</option></select></label><label>到期时间<input type="time" required value={batchDraft.dueTime} onChange={(event) => setBatchDraft({ ...batchDraft, dueTime: event.target.value })} /></label></div>
      <div className="row"><label>从<input type="date" required value={batchDraft.startDate} onChange={(event) => setBatchDraft({ ...batchDraft, startDate: event.target.value })} /></label><label>到<input type="date" required value={batchDraft.endDate} onChange={(event) => setBatchDraft({ ...batchDraft, endDate: event.target.value })} /></label></div>
      <label>备注<textarea rows={4} value={batchDraft.notes} onChange={(event) => setBatchDraft({ ...batchDraft, notes: event.target.value })} placeholder="这项每周作业的固定说明……" /></label>
      <div className="actions"><button type="button" className="plain" onClick={() => setBatchFormOpen(false)}>取消</button><button className="add">创建每周作业</button></div>
    </form></div>}

    {calendarFormOpen && <div className="modal-backdrop" onMouseDown={() => setCalendarFormOpen(false)}><form className="modal calendar-modal" onSubmit={saveCalendarItem} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">每周安排</p><h2>{calendarMode === 'course' ? '添加课程或任务' : '添加每周任务'}</h2></div>
      <div className="row"><label>星期<select value={calendarDraft.weekday} onChange={(event) => setCalendarDraft({ ...calendarDraft, weekday: event.target.value })}>{weekDays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>{calendarMode === 'course' && <label>类型<select value={calendarDraft.kind} onChange={(event) => setCalendarDraft({ ...calendarDraft, kind: event.target.value as '课程' | '任务' })}><option>课程</option><option>任务</option></select></label>}</div>
      <label>{calendarMode === 'course' ? '课程或任务名称' : '任务名称'}<input autoFocus required value={calendarDraft.title} onChange={(event) => setCalendarDraft({ ...calendarDraft, title: event.target.value })} placeholder={calendarMode === 'course' ? '例如：STAT 101 Lecture' : '例如：复习本周笔记'} /></label>
      <label>时间（可选）<input type="time" value={calendarDraft.time} onChange={(event) => setCalendarDraft({ ...calendarDraft, time: event.target.value })} /></label>
      <div className="actions"><button type="button" className="plain" onClick={() => setCalendarFormOpen(false)}>取消</button><button className="add">保存安排</button></div>
    </form></div>}

    {courseFormOpen && <div className="modal-backdrop" onMouseDown={closeCourseForm}><form className="modal course-modal" onSubmit={saveCourse} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">课程管理</p><h2>{editingCourse ? '编辑课程评分' : '添加课程'}</h2><p className="modal-copy">设置课程的评分项目；填写后各项比例需要合计 100%。</p></div>
      <label>课程名称<input autoFocus={!editingCourse} required disabled={Boolean(editingCourse)} value={courseName} onChange={(event) => { setCourseName(event.target.value); setGradeError(''); }} placeholder="例如：History 201" /></label>
      <div className="grading-editor"><div className="grading-head"><span>评分分布</span><strong className={gradeRows.some((row) => row.name || row.weight) && Math.abs(gradeTotal - 100) > 0.001 ? 'total-warning' : ''}>合计 {gradeTotal}%</strong></div>{gradeRows.map((row) => <div className="grade-row" key={row.id}><input aria-label="评分项目名称" value={row.name} onChange={(event) => { setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item)); setGradeError(''); }} placeholder="例如：Midterm" /><select aria-label="评分项目类型" value={row.kind} onChange={(event) => setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, kind: event.target.value as 'exam' | 'task' } : item))}><option value="exam">考试</option><option value="task">任务</option></select><div className="weight-input"><input aria-label="评分比例" type="number" min="0.01" max="100" step="0.01" value={row.weight} onChange={(event) => { setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, weight: event.target.value } : item)); setGradeError(''); }} placeholder="50" /><span>%</span></div><button type="button" aria-label="删除评分项目" onClick={() => setGradeRows(gradeRows.filter((item) => item.id !== row.id))}>×</button></div>)}<button type="button" className="add-grade" onClick={() => setGradeRows([...gradeRows, { id: Date.now(), name: '', weight: '', kind: 'task' }])}>＋ 添加评分项目</button>{gradeError && <p className="form-error">{gradeError}</p>}</div>
      <button className="add course-save">{editingCourse ? '保存评分设置' : '保存课程'}</button>
      {courses.length > 0 && <div className="course-list"><p>已有课程</p>{courses.map((course) => <div className="course-row" key={course.name}><div className="course-info"><span><strong>{course.name}</strong><small>{tasks.filter((task) => task.course === course.name).length} 项作业</small></span><p>{course.grading.length ? course.grading.map((item) => `${item.name}（${item.kind === 'exam' ? '考试' : '任务'}） ${item.weight}%`).join(' · ') : '尚未设置评分分布'}</p></div><div className="course-actions"><button type="button" className="course-edit" disabled={course.name === UNASSIGNED} onClick={() => editCourse(course)}>编辑评分</button><button type="button" className="course-delete" disabled={course.name === UNASSIGNED} title={course.name === UNASSIGNED ? '系统分类不能删除' : `删除 ${course.name}`} onClick={() => deleteCourse(course.name)}>{course.name === UNASSIGNED ? '保留' : '删除'}</button></div></div>)}</div>}
      <div className="actions"><button type="button" className="plain" onClick={closeCourseForm}>完成</button></div>
    </form></div>}

    {selectedTask && <div className="modal-backdrop" onMouseDown={() => setSelectedTask(null)}><section className="modal detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="detail-top"><div><p className="eyebrow">作业详情</p><h2>{selectedTask.title}</h2></div><button className="close" aria-label="关闭详情" onClick={() => setSelectedTask(null)}>×</button></div><div className="detail-meta"><span>{selectedTask.course}</span>{selectedTask.gradeCategory && <span>{selectedTask.gradeCategory}</span>}<span>{formatDate(selectedTask.due)}</span></div><div className="assignment-grade-editor"><p>成绩记录</p><div className="row"><label>任务类别<select disabled={!taskCategoriesFor(selectedTaskCourse).length} value={selectedTask.gradeCategory} onChange={(event) => setSelectedTask({ ...selectedTask, gradeCategory: event.target.value })}>{taskCategoriesFor(selectedTaskCourse).length ? taskCategoriesFor(selectedTaskCourse).map((category) => <option key={category.name}>{category.name}</option>) : <option value="">没有任务类别</option>}</select></label><label>成绩<div className="score-input"><input type="number" min="0" max="100" step="0.01" value={selectedTask.score ?? ''} onChange={(event) => setSelectedTask({ ...selectedTask, score: event.target.value === '' ? null : Number(event.target.value) })} placeholder="尚未评分" /><span>%</span></div></label></div><button className="secondary save-grade" onClick={saveSelectedTaskGrade}>保存成绩</button></div><div className="notes-block"><p>备注</p><div>{selectedTask.notes || '这项作业还没有备注。'}</div></div><div className="actions"><button className="add" onClick={() => setSelectedTask(null)}>完成查看</button></div></section></div>}
  </main>;
}
