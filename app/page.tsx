'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './supabase';

type DataSource = 'manual' | 'mock' | 'canvas';
type Task = { id: number; title: string; course: string; due: string; done: boolean; notes: string; gradeCategory: string; score: number | null; source?: DataSource; externalId?: string | null };
type GradeCategory = { name: string; weight: number; kind: 'exam' | 'task'; score: number | null };
type Course = { name: string; grading: GradeCategory[]; source?: DataSource; externalId?: string | null };
type GradeRow = { id: number; name: string; weight: string; kind: 'exam' | 'task' };
type WeeklyItem = { id: number; weekday: number; title: string; time: string; endTime?: string; kind: '课程' | '任务'; course?: string; location?: string; color?: string };
type Forecast = { target: number; scores: Record<string, number> };
type DataBundle = { format: 'deadline-tracker'; version: 2; savedAt: string; tasks: Task[]; courses: Course[]; weeklyCourses: WeeklyItem[]; weeklyAssignments: WeeklyItem[]; forecasts: Record<string, Forecast> };
const COURSE_COLORS = ['#d76648', '#5579a6', '#63856b', '#9a68a0', '#c28a35', '#4f8c91', '#b85f78', '#766ab0', '#8b7657', '#4c8273', '#a85e42', '#6b7fba'];

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0;
}

function addMinutesToTime(time: string, amount: number) {
  const minutes = Math.min(23 * 60 + 59, timeToMinutes(time) + amount);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatClock(time: string) {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(2026, 0, 1, hours, minutes));
}

function normalizeWeeklyItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  const colorsByCourse = new Map<string, string>();
  return value.map((raw, index) => {
    const item = raw as Partial<WeeklyItem>;
    const kind = item.kind === '课程' ? '课程' as const : '任务' as const;
    const title = typeof item.title === 'string' ? item.title : '未命名安排';
    const course = typeof item.course === 'string' ? item.course : undefined;
    const location = typeof item.location === 'string' ? item.location : undefined;
    let color = typeof item.color === 'string' ? item.color : undefined;
    if (kind === '课程') {
      const colorKey = (course || title).toLocaleLowerCase();
      color = colorsByCourse.get(colorKey) ?? color ?? COURSE_COLORS[colorsByCourse.size % COURSE_COLORS.length];
      colorsByCourse.set(colorKey, color);
    }
    return {
      id: typeof item.id === 'number' ? item.id : Date.now() + index,
      weekday: typeof item.weekday === 'number' ? item.weekday : 1,
      title,
      time: typeof item.time === 'string' ? item.time : '',
      endTime: typeof item.endTime === 'string' ? item.endTime : (kind === '课程' && item.time ? addMinutesToTime(item.time, 60) : undefined),
      kind,
      course,
      location,
      color,
    };
  });
}

const seed: Task[] = [];
const seedCourses: Course[] = [];
const UNASSIGNED = '未分类';
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(date));
const blankGradeRows = (): GradeRow[] => [{ id: Date.now(), name: '', weight: '', kind: 'task' }, { id: Date.now() + 1, name: '', weight: '', kind: 'task' }];
const taskCategoriesFor = (course: Course | undefined) => (course?.grading ?? []).filter((category) => category.kind === 'task');

function normalizeDataBundle(value: unknown): DataBundle {
  const raw = value && typeof value === 'object' ? value as Partial<DataBundle> : {};
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map((task) => ({
    ...task,
    due: typeof task.due === 'string' && task.due.includes('T') ? task.due : `${task.due || new Date().toISOString().slice(0, 10)}T23:59`,
    notes: task.notes ?? '',
    gradeCategory: task.gradeCategory ?? '',
    score: typeof task.score === 'number' ? task.score : null,
    source: task.source === 'canvas' || task.source === 'mock' ? task.source : 'manual' as const,
    externalId: typeof task.externalId === 'string' ? task.externalId : null,
  })) : [];
  const courses = Array.isArray(raw.courses) ? (raw.courses as Array<string | Course>).map((course) => typeof course === 'string'
    ? { name: course, grading: [], source: 'manual' as const, externalId: null }
    : {
        name: course.name,
        grading: Array.isArray(course.grading) ? course.grading.map((category) => ({ ...category, kind: category.kind === 'exam' ? 'exam' as const : 'task' as const, score: typeof category.score === 'number' ? category.score : null })) : [],
        source: course.source === 'canvas' || course.source === 'mock' ? course.source : 'manual' as const,
        externalId: typeof course.externalId === 'string' ? course.externalId : null,
      }) : [];
  for (const name of tasks.map((task) => task.course)) {
    if (name && !courses.some((course) => course.name === name)) courses.push({ name, grading: [], source: 'manual', externalId: null });
  }
  return {
    format: 'deadline-tracker',
    version: 2,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
    tasks,
    courses,
    weeklyCourses: normalizeWeeklyItems(raw.weeklyCourses),
    weeklyAssignments: normalizeWeeklyItems(raw.weeklyAssignments),
    forecasts: raw.forecasts && typeof raw.forecasts === 'object' ? raw.forecasts : {},
  };
}

function readLegacyBrowserData(): DataBundle | null {
  const savedTasks = localStorage.getItem('deadline-tasks');
  const savedCourses = localStorage.getItem('deadline-courses');
  const savedWeeklyCourses = localStorage.getItem('deadline-weekly-courses');
  const savedWeeklyAssignments = localStorage.getItem('deadline-weekly-assignments');
  const savedForecasts = localStorage.getItem('deadline-grade-forecasts');
  if (![savedTasks, savedCourses, savedWeeklyCourses, savedWeeklyAssignments, savedForecasts].some(Boolean)) return null;
  try {
    return normalizeDataBundle({
      tasks: savedTasks ? JSON.parse(savedTasks) : [],
      courses: savedCourses ? JSON.parse(savedCourses) : [],
      weeklyCourses: savedWeeklyCourses ? JSON.parse(savedWeeklyCourses) : [],
      weeklyAssignments: savedWeeklyAssignments ? JSON.parse(savedWeeklyAssignments) : [],
      forecasts: savedForecasts ? JSON.parse(savedForecasts) : {},
    });
  } catch {
    return null;
  }
}

export default function Page() {
  const [tasks, setTasks] = useState<Task[]>(seed);
  const [courses, setCourses] = useState<Course[]>(seedCourses);
  const [storageReady, setStorageReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [cloudStatus, setCloudStatus] = useState('正在连接云端…');
  const [cloudStatusKind, setCloudStatusKind] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const hydratedUserRef = useRef<string | null>(null);
  const calendarPreviewRef = useRef<HTMLElement>(null);
  const expandedCalendarRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState('全部');
  const [categoryFilter, setCategoryFilter] = useState('全部类别');
  const [formOpen, setFormOpen] = useState(false);
  const [batchFormOpen, setBatchFormOpen] = useState(false);
  const [calendarMode, setCalendarMode] = useState<'course' | 'task'>('course');
  const [calendarFormOpen, setCalendarFormOpen] = useState(false);
  const [editingCalendarItemId, setEditingCalendarItemId] = useState<number | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarDraft, setCalendarDraft] = useState<{ weekday: string; title: string; time: string; endTime: string; kind: '课程' | '任务'; course: string; location: string }>({ weekday: '1', title: '', time: '09:00', endTime: '10:00', kind: '课程', course: seedCourses[0]?.name ?? '', location: '' });
  const [weeklyCourses, setWeeklyCourses] = useState<WeeklyItem[]>([]);
  const [weeklyAssignments, setWeeklyAssignments] = useState<WeeklyItem[]>([]);
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [courseName, setCourseName] = useState('');
  const [editingCourse, setEditingCourse] = useState<string | null>(null);
  const [gradeRows, setGradeRows] = useState<GradeRow[]>([{ id: 1, name: '', weight: '', kind: 'task' }, { id: 2, name: '', weight: '', kind: 'task' }]);
  const [gradeError, setGradeError] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<{ title: string; course: string; due: string; notes: string; gradeCategory: string; score: string }>({ title: '', course: '', due: `${new Date().toISOString().slice(0, 10)}T23:59`, notes: '', gradeCategory: '', score: '' });
  const [batchDraft, setBatchDraft] = useState({ title: 'Weekly Assignment', course: '', gradeCategory: '', weekday: '1', dueTime: '23:59', startDate: new Date().toISOString().slice(0, 10), endDate: new Date(new Date().setMonth(new Date().getMonth() + 4)).toISOString().slice(0, 10), notes: '' });
  const dataBundle = useMemo<DataBundle>(() => ({ format: 'deadline-tracker', version: 2, savedAt: new Date().toISOString(), tasks, courses, weeklyCourses, weeklyAssignments, forecasts }), [tasks, courses, weeklyCourses, weeklyAssignments, forecasts]);

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setAuthReady(true);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        hydratedUserRef.current = null;
        setStorageReady(false);
        applyDataBundle(normalizeDataBundle({}));
      }
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    const client = supabase;
    const userId = session.user.id;
    let cancelled = false;
    setStorageReady(false);
    setCloudStatus('正在读取云端数据…');
    setCloudStatusKind('loading');
    void (async () => {
      const { data, error } = await client.from('tracker_states').select('data').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      let bundle: DataBundle;
      if (data?.data) {
        bundle = normalizeDataBundle(data.data);
      } else {
        const migrationKey = `deadline-cloud-migrated-${userId}`;
        const legacy = localStorage.getItem(migrationKey) ? null : readLegacyBrowserData();
        bundle = legacy ?? normalizeDataBundle({});
        const { error: createError } = await client.from('tracker_states').upsert({ user_id: userId, data: bundle, updated_at: new Date().toISOString() });
        if (createError) throw createError;
        if (legacy) localStorage.setItem(migrationKey, 'true');
      }
      if (cancelled) return;
      applyDataBundle(bundle);
      hydratedUserRef.current = userId;
      setStorageReady(true);
      setCloudStatus('所有更改已保存');
      setCloudStatusKind('saved');
    })().catch((error: unknown) => {
      if (cancelled) return;
      setCloudStatus(error instanceof Error ? error.message : '无法读取云端数据');
      setCloudStatusKind('error');
    });
    return () => { cancelled = true; };
  }, [session?.user.id]);

  useEffect(() => {
    if (!storageReady || !session || !supabase || hydratedUserRef.current !== session.user.id) return;
    const client = supabase;
    const userId = session.user.id;
    setCloudStatus('正在保存…');
    setCloudStatusKind('saving');
    const timer = window.setTimeout(() => {
      void (async () => {
        const { error } = await client.from('tracker_states').upsert({ user_id: userId, data: dataBundle, updated_at: new Date().toISOString() });
        if (error) throw error;
        setCloudStatus(`已保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
        setCloudStatusKind('saved');
      })().catch((error: unknown) => {
        setCloudStatus(error instanceof Error ? error.message : '云端保存失败');
        setCloudStatusKind('error');
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [dataBundle, session?.user.id, storageReady]);

  useEffect(() => {
    if (!calendarExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCalendarExpanded(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [calendarExpanded]);

  useLayoutEffect(() => {
    if (!calendarExpanded || !calendarPreviewRef.current || !expandedCalendarRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const preview = calendarPreviewRef.current.getBoundingClientRect();
    const expanded = expandedCalendarRef.current.getBoundingClientRect();
    const offsetX = preview.left + preview.width / 2 - (expanded.left + expanded.width / 2);
    const offsetY = preview.top + preview.height / 2 - (expanded.top + expanded.height / 2);
    const scaleX = Math.max(0.15, preview.width / expanded.width);
    const scaleY = Math.max(0.15, preview.height / expanded.height);
    const animation = expandedCalendarRef.current.animate([
      { opacity: 0.55, transform: `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`, borderRadius: '12px' },
      { opacity: 1, transform: 'translate(0, 0) scale(1, 1)', borderRadius: '16px' },
    ], { duration: 300, easing: 'cubic-bezier(.22,.78,.24,1)', fill: 'both' });
    return () => animation.cancel();
  }, [calendarExpanded]);

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

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage('');
    const result = authMode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
      : await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword, options: { emailRedirectTo: window.location.href } });
    setAuthBusy(false);
    if (result.error) {
      setAuthMessage(result.error.message);
      return;
    }
    if (authMode === 'signup' && !result.data.session) setAuthMessage('注册成功。请打开验证邮件，确认后再登录。');
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
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
    setTasks([{ ...draft, title: draft.title.trim(), notes: draft.notes.trim(), score: draft.score === '' ? null : Number(draft.score), id: Date.now(), done: false, source: 'manual', externalId: null }, ...tasks]);
    setDraft({ title: '', course: draft.course, due: `${new Date().toISOString().slice(0, 10)}T23:59`, notes: '', gradeCategory: draft.gradeCategory, score: '' });
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
    const nameConflict = courses.some((course) => course.name !== editingCourse && course.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (nameConflict) {
      setGradeError('已经存在同名课程，请使用另一个名称。');
      return;
    }
    const grading = usedRows.map((row, index) => ({ name: row.name.trim(), weight: Number(row.weight), kind: row.kind, score: previous?.grading[index]?.kind === row.kind ? previous.grading[index].score : null }));
    const total = grading.reduce((sum, item) => sum + item.weight, 0);
    if (grading.length && Math.abs(total - 100) > 0.001) {
      setGradeError(`评分比例当前合计 ${total}%，需要正好为 100%。`);
      return;
    }
    if (editingCourse) {
      const categoryUpdates = new Map(previous?.grading.map((item, index) => [item.name, grading[index]]) ?? []);
      setTasks(tasks.map((task) => task.course === editingCourse && task.gradeCategory && categoryUpdates.has(task.gradeCategory)
        ? { ...task, course: name, gradeCategory: categoryUpdates.get(task.gradeCategory)?.kind === 'task' ? categoryUpdates.get(task.gradeCategory)?.name ?? '' : '' }
        : task.course === editingCourse ? { ...task, course: name } : task));
      setWeeklyCourses(weeklyCourses.map((item) => item.course === editingCourse ? { ...item, course: name } : item));
      setWeeklyAssignments(weeklyAssignments.map((item) => item.course === editingCourse ? { ...item, course: name } : item));
      setForecasts((current) => {
        if (name === editingCourse || !current[editingCourse]) return current;
        const { [editingCourse]: renamedForecast, ...rest } = current;
        return { ...rest, [name]: renamedForecast };
      });
      setCourses(courses.map((course) => course.name === editingCourse ? { ...course, name, grading } : course));
      setFilter((current) => current === editingCourse ? name : current);
      setDraft((current) => ({ ...current, course: current.course === editingCourse ? name : current.course }));
      setBatchDraft((current) => ({ ...current, course: current.course === editingCourse ? name : current.course }));
      closeCourseForm();
      return;
    }
    const existing = courses.find((course) => course.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      setGradeError('这个课程已经存在，可以在下方选择“编辑评分”。');
      return;
    }
    setCourses([...courses, { name, grading, source: 'manual', externalId: null }]);
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
    const nextCourses = affected && !remaining.some((item) => item.name === UNASSIGNED) ? [...remaining, { name: UNASSIGNED, grading: [], source: 'manual' as const, externalId: null }] : remaining;
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
        additions.push({ id: Date.now() + additions.length, title: batchDraft.title.trim(), course: batchDraft.course, due: `${date}T${batchDraft.dueTime}`, done: false, notes: batchDraft.notes.trim(), gradeCategory: batchDraft.gradeCategory, score: null, source: 'manual', externalId: null });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    if (!additions.length) return;
    setTasks([...additions, ...tasks]);
    setBatchFormOpen(false);
  }

  function openCalendarForm(weekday: number) {
    const defaultCourse = courses.find((course) => course.name !== UNASSIGNED)?.name ?? '';
    setEditingCalendarItemId(null);
    setCalendarDraft({ weekday: String(weekday), title: '', time: calendarMode === 'course' ? '09:00' : '', endTime: calendarMode === 'course' ? '10:00' : '', kind: calendarMode === 'course' ? '课程' : '任务', course: calendarMode === 'course' ? defaultCourse : '', location: '' });
    setCalendarError('');
    setCalendarFormOpen(true);
  }

  function editCalendarItem(item: WeeklyItem) {
    setEditingCalendarItemId(item.id);
    setCalendarDraft({
      weekday: String(item.weekday),
      title: item.title,
      time: item.time,
      endTime: item.endTime ?? (item.kind === '课程' && item.time ? addMinutesToTime(item.time, 60) : ''),
      kind: item.kind,
      course: item.course ?? '',
      location: item.location ?? '',
    });
    setCalendarError('');
    setCalendarFormOpen(true);
  }

  function closeCalendarForm() {
    setCalendarFormOpen(false);
    setEditingCalendarItemId(null);
    setCalendarError('');
  }

  function saveCalendarItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calendarDraft.title.trim()) return;
    if (calendarMode === 'course' && calendarDraft.kind === '课程' && (!calendarDraft.time || !calendarDraft.endTime || timeToMinutes(calendarDraft.endTime) <= timeToMinutes(calendarDraft.time))) {
      setCalendarError('课程结束时间必须晚于开始时间。');
      return;
    }
    const title = calendarDraft.title.trim();
    const course = calendarMode === 'course' && calendarDraft.kind === '课程' ? calendarDraft.course : '';
    const colorKey = (course || title).toLocaleLowerCase();
    const itemColorKey = (item: WeeklyItem) => (item.course || item.title).toLocaleLowerCase();
    const originalItem = (calendarMode === 'course' ? weeklyCourses : weeklyAssignments).find((item) => item.id === editingCalendarItemId);
    const otherCourses = weeklyCourses.filter((item) => item.id !== editingCalendarItemId && item.kind === '课程');
    const groupedColor = otherCourses.find((item) => itemColorKey(item) === colorKey)?.color;
    const originalColor = originalItem?.kind === '课程' && itemColorKey(originalItem) === colorKey ? originalItem.color : undefined;
    const usedColors = new Set(otherCourses.filter((item) => itemColorKey(item) !== colorKey).map((item) => item.color).filter((color): color is string => Boolean(color)));
    const availableColor = COURSE_COLORS.find((color) => !usedColors.has(color)) ?? COURSE_COLORS[otherCourses.length % COURSE_COLORS.length];
    const item: WeeklyItem = {
      id: editingCalendarItemId ?? Date.now(),
      weekday: Number(calendarDraft.weekday),
      title,
      time: calendarDraft.time,
      endTime: calendarMode === 'course' && calendarDraft.kind === '课程' ? calendarDraft.endTime : undefined,
      kind: calendarMode === 'course' ? calendarDraft.kind : '任务',
      course: course || undefined,
      location: calendarMode === 'course' && calendarDraft.kind === '课程' ? calendarDraft.location.trim() || undefined : undefined,
      color: calendarMode === 'course' && calendarDraft.kind === '课程' ? groupedColor ?? originalColor ?? availableColor : undefined,
    };
    if (calendarMode === 'course') setWeeklyCourses(editingCalendarItemId === null ? [...weeklyCourses, item] : weeklyCourses.map((current) => current.id === editingCalendarItemId ? item : current));
    else setWeeklyAssignments(editingCalendarItemId === null ? [...weeklyAssignments, item] : weeklyAssignments.map((current) => current.id === editingCalendarItemId ? item : current));
    closeCalendarForm();
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
  const scheduledCourses = weeklyCourses.filter((item) => item.kind === '课程' && item.time);
  const courseStarts = scheduledCourses.map((item) => timeToMinutes(item.time));
  const courseEnds = scheduledCourses.map((item) => timeToMinutes(item.endTime ?? addMinutesToTime(item.time, 60)));
  const timetableStart = Math.max(0, Math.floor(((courseStarts.length ? Math.min(...courseStarts) : 9 * 60) - 60) / 60) * 60);
  const timetableEnd = Math.min(24 * 60, Math.max(timetableStart + 8 * 60, Math.ceil(((courseEnds.length ? Math.max(...courseEnds) : 17 * 60) + 60) / 60) * 60));
  const timetableDuration = Math.max(60, timetableEnd - timetableStart);
  const timetableHeight = Math.max(500, timetableDuration / 60 * 54);
  const timetableHours = Array.from({ length: Math.floor(timetableDuration / 60) + 1 }, (_, index) => timetableStart + index * 60);
  const todayLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

  if (!supabaseConfigured) return <main className="auth-shell">
    <section className="auth-card setup-card">
      <div className="auth-brand"><span className="mark">D</span><strong>deadline</strong></div>
      <div><p className="eyebrow">Cloud setup</p><h1>云端后端尚未连接</h1></div>
      <p>新版已经迁移到 Supabase，但本机还没有项目地址和浏览器可用的 publishable key。完成一次配置后，课程、作业、课表和成绩会按账户自动保存。</p>
      <ol className="setup-steps"><li>在 Supabase 创建项目并运行仓库中的数据库迁移 SQL。</li><li>复制项目 URL 和 publishable key 到 <code>.env.local</code>。</li><li>重新启动开发服务器；部署时把同名变量添加为 GitHub Actions secrets。</li></ol>
      <small>完整步骤见项目根目录的 SUPABASE_SETUP.md。不要把 service role key 放进前端。</small>
    </section>
  </main>;

  if (!authReady) return <main className="auth-shell"><section className="auth-card auth-loading"><span className="cloud-spinner" /><p>正在检查登录状态…</p></section></main>;

  if (!session) return <main className="auth-shell">
    <section className="auth-card">
      <div className="auth-brand"><span className="mark">D</span><strong>deadline</strong></div>
      <div><p className="eyebrow">{authMode === 'signin' ? 'Welcome back' : 'Create account'}</p><h1>{authMode === 'signin' ? '登录你的学习空间' : '创建学习空间'}</h1><p>每个账户的数据相互隔离，并自动同步到云端。</p></div>
      <form className="auth-form" onSubmit={submitAuth}>
        <label>邮箱<input type="email" autoComplete="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>密码<input type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} minLength={6} required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="至少 6 位" /></label>
        {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
        <button className="add" disabled={authBusy}>{authBusy ? '请稍候…' : authMode === 'signin' ? '登录' : '注册'}</button>
      </form>
      <button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthMessage(''); }}>{authMode === 'signin' ? '还没有账户？注册' : '已有账户？登录'}</button>
    </section>
  </main>;

  if (!storageReady) return <main className="auth-shell"><section className="auth-card auth-loading"><span className={cloudStatusKind === 'error' ? 'cloud-error-mark' : 'cloud-spinner'} />
    <div><h1>{cloudStatusKind === 'error' ? '无法读取云端数据' : '正在打开你的学习空间'}</h1><p>{cloudStatus}</p></div>
    {cloudStatusKind === 'error' && <button type="button" className="secondary" onClick={() => window.location.reload()}>重新尝试</button>}
  </section></main>;

  return <main>
    <header>
      <div className="brand"><span className="mark">D</span><span>deadline</span></div>
      <div className="date">{todayLabel}</div>
      <div className="header-actions">
        <div className={`cloud-status ${cloudStatusKind}`} title={session.user.email ?? '已登录'} aria-live="polite"><span aria-hidden="true" /><div><strong>{cloudStatus}</strong><small>{session.user.email}</small></div></div>
        <button type="button" className="account-signout" onClick={signOut}>退出</button>
        <button className="secondary" onClick={openCourseForm}>＋ 添加课程</button><button className="secondary" onClick={openBatchForm}>＋ 批量添加</button><button className="add" onClick={openTaskForm}>＋ 添加作业</button>
      </div>
    </header>
    <section className="overview-grid">
      <div className="overview-left"><section className="urgent-panel"><div><p className="eyebrow">24 小时内</p><h2>即将到期</h2></div>{urgent.length ? <div className="urgent-list">{urgent.map((task) => <button key={task.id} className="urgent-item" onClick={() => setSelectedTask(task)}><span>{task.title}</span><small>{formatDate(task.due)}</small></button>)}</div> : <p className="urgent-empty">未来 24 小时没有截止事项。</p>}</section><section className="metrics"><article><span>待完成</span><strong>{stats.total}</strong><small>项作业</small></article><article className="accent"><span>未来 7 天</span><strong>{stats.soon}</strong><small>项需要关注</small></article></section></div>
      <section ref={calendarPreviewRef} className={`calendar-panel ${calendarMode === 'course' ? 'expandable' : ''}`} aria-label="每周日历" onClick={(event) => { if (calendarMode === 'course' && !(event.target as HTMLElement).closest('button')) setCalendarExpanded(true); }}>
        <div className="calendar-head"><p className="eyebrow">日历</p><div className="calendar-head-actions">{calendarMode === 'course' && <button className="calendar-expand-button" onClick={() => setCalendarExpanded(true)}>展开课表</button>}<div className="calendar-tabs"><button className={calendarMode === 'course' ? 'selected' : ''} onClick={() => setCalendarMode('course')}>每周课程</button><button className={calendarMode === 'task' ? 'selected' : ''} onClick={() => setCalendarMode('task')}>每周作业</button></div></div></div>
        <div className="week-grid">{weekDays.map((day) => {
          const dayItems = calendarItems.filter((item) => item.weekday === day.value);
          const previewItems = calendarMode === 'course' ? dayItems.slice(0, 3) : dayItems;
          return <section className={`week-day ${today === day.value ? 'today' : ''}`} key={day.value}><div className="week-day-head"><span>{day.label}</span>{today === day.value && <small>今天</small>}</div><div className="week-items">{previewItems.map((item) => <div className={`week-item ${calendarMode === 'course' && item.kind === '课程' ? 'course-preview-item' : ''}`} style={calendarMode === 'course' && item.color ? { '--course-color': item.color } as React.CSSProperties : undefined} title={item.location ? `${item.title} · ${item.location}` : item.title} key={item.id}><div className="week-item-actions"><button type="button" onClick={() => editCalendarItem(item)} aria-label={`编辑 ${item.title}`} title="编辑">✎</button><button type="button" onClick={() => deleteCalendarItem(item.id)} aria-label={`删除 ${item.title}`} title="删除">×</button></div>{item.time && <small>{calendarMode === 'course' && item.kind === '课程' ? `${formatClock(item.time)}–${formatClock(item.endTime ?? addMinutesToTime(item.time, 60))}` : item.time}</small>}<span>{item.title}</span>{calendarMode === 'course' && <em>{item.course || item.kind}</em>}</div>)}{calendarMode === 'course' && dayItems.length > previewItems.length && <button className="week-more" onClick={() => setCalendarExpanded(true)}>＋{dayItems.length - previewItems.length}</button>}</div><button className="week-add" onClick={() => openCalendarForm(day.value)}>＋</button></section>;
        })}</div>
      </section>
    </section>
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

    {calendarFormOpen && <div className="modal-backdrop" onMouseDown={closeCalendarForm}><form className="modal calendar-modal" onSubmit={saveCalendarItem} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">每周安排</p><h2>{editingCalendarItemId !== null ? '编辑安排' : calendarMode === 'course' ? '添加课程或任务' : '添加每周任务'}</h2></div>
      <div className="row"><label>星期<select value={calendarDraft.weekday} onChange={(event) => setCalendarDraft({ ...calendarDraft, weekday: event.target.value })}>{weekDays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>{calendarMode === 'course' && <label>类型<select value={calendarDraft.kind} onChange={(event) => { const kind = event.target.value as '课程' | '任务'; const defaultCourse = courses.find((course) => course.name !== UNASSIGNED)?.name ?? ''; setCalendarDraft({ ...calendarDraft, kind, time: kind === '课程' ? calendarDraft.time || '09:00' : calendarDraft.time, endTime: kind === '课程' ? calendarDraft.endTime || addMinutesToTime(calendarDraft.time || '09:00', 60) : '', course: kind === '课程' ? calendarDraft.course || defaultCourse : '' }); setCalendarError(''); }}><option>课程</option><option>任务</option></select></label>}</div>
      <label>{calendarMode === 'course' ? '课程或任务名称' : '任务名称'}<input autoFocus required value={calendarDraft.title} onChange={(event) => setCalendarDraft({ ...calendarDraft, title: event.target.value })} placeholder={calendarMode === 'course' ? '例如：STAT 101 Lecture' : '例如：复习本周笔记'} /></label>
      {calendarMode === 'course' && calendarDraft.kind === '课程' && <label>所属课程（决定颜色）<select value={calendarDraft.course} onChange={(event) => setCalendarDraft({ ...calendarDraft, course: event.target.value })}><option value="">独立安排（按名称配色）</option>{courses.filter((course) => course.name !== UNASSIGNED).map((course) => <option key={course.name} value={course.name}>{course.name}</option>)}</select><small className="field-hint">Lecture、Lab 等不同安排选择同一门课程后会保持相同颜色。</small></label>}
      {calendarMode === 'course' && calendarDraft.kind === '课程' && <label>上课地点（可选）<input value={calendarDraft.location} onChange={(event) => setCalendarDraft({ ...calendarDraft, location: event.target.value })} placeholder="例如：Mason Hall 2306" /></label>}
      {calendarMode === 'course' && calendarDraft.kind === '课程' ? <div className="row"><label>开始时间<input type="time" required value={calendarDraft.time} onChange={(event) => { const time = event.target.value; setCalendarDraft({ ...calendarDraft, time, endTime: !calendarDraft.endTime || timeToMinutes(calendarDraft.endTime) <= timeToMinutes(time) ? addMinutesToTime(time, 60) : calendarDraft.endTime }); setCalendarError(''); }} /></label><label>结束时间<input type="time" required value={calendarDraft.endTime} onChange={(event) => { setCalendarDraft({ ...calendarDraft, endTime: event.target.value }); setCalendarError(''); }} /></label></div> : <label>时间（可选）<input type="time" value={calendarDraft.time} onChange={(event) => setCalendarDraft({ ...calendarDraft, time: event.target.value })} /></label>}
      {calendarError && <p className="form-error">{calendarError}</p>}
      <div className="actions"><button type="button" className="plain" onClick={closeCalendarForm}>取消</button><button className="add">{editingCalendarItemId !== null ? '保存修改' : '保存安排'}</button></div>
    </form></div>}

    {calendarExpanded && <div className="calendar-expanded-backdrop" role="presentation" onClick={() => setCalendarExpanded(false)}><section ref={expandedCalendarRef} className="expanded-calendar" role="dialog" aria-modal="true" aria-labelledby="expanded-calendar-title">
      <div className="expanded-calendar-head"><div><p className="eyebrow">每周课程</p><h2 id="expanded-calendar-title">课程时间表</h2><p>课程条的长度对应上课时长 · 点击任意位置关闭</p></div><button aria-label="关闭展开课表">×</button></div>
      <div className="timetable-scroll"><div className="expanded-calendar-grid">
        <div className="expanded-corner" />
        <div className="expanded-day-heads">{weekDays.map((day) => <div className={today === day.value ? 'today' : ''} key={day.value}><span>{day.label}</span>{today === day.value && <small>今天</small>}</div>)}</div>
        <div className="expanded-time-axis" style={{ height: timetableHeight }}>{timetableHours.map((minutes) => <span style={{ top: `${(minutes - timetableStart) / timetableDuration * 100}%` }} key={minutes}>{String(Math.floor(minutes / 60)).padStart(2, '0')}:00</span>)}</div>
        <div className="expanded-week-body" style={{ height: timetableHeight, backgroundSize: `100% ${54}px` }}>{weekDays.map((day) => <div className={`expanded-day-column ${today === day.value ? 'today' : ''}`} key={day.value}>{scheduledCourses.filter((item) => item.weekday === day.value).map((item) => {
          const start = timeToMinutes(item.time);
          const end = Math.max(start + 15, timeToMinutes(item.endTime ?? addMinutesToTime(item.time, 60)));
          return <article className="course-time-bar" title={[item.title, item.course, item.location, `${formatClock(item.time)}–${formatClock(item.endTime ?? addMinutesToTime(item.time, 60))}`].filter(Boolean).join(' · ')} style={{ '--course-color': item.color ?? COURSE_COLORS[0], top: `${(start - timetableStart) / timetableDuration * 100}%`, height: `${(end - start) / timetableDuration * 100}%` } as React.CSSProperties} key={item.id}><strong>{item.title}</strong>{(item.course || item.location) && <em>{[item.course, item.location].filter(Boolean).join(' · ')}</em>}<span>{formatClock(item.time)}–{formatClock(item.endTime ?? addMinutesToTime(item.time, 60))}</span></article>;
        })}</div>)}{!scheduledCourses.length && <p className="expanded-calendar-empty">还没有课程。关闭后点击某一天的＋添加。</p>}</div>
      </div></div>
    </section></div>}

    {courseFormOpen && <div className="modal-backdrop" onMouseDown={closeCourseForm}><form className="modal course-modal" onSubmit={saveCourse} onMouseDown={(event) => event.stopPropagation()}>
      <div><p className="eyebrow">课程管理</p><h2>{editingCourse ? '编辑课程' : '添加课程'}</h2><p className="modal-copy">课程名称和评分项目都可以修改；填写评分项目后，各项比例需要合计 100%。</p></div>
      <label>课程名称<input autoFocus required value={courseName} onChange={(event) => { setCourseName(event.target.value); setGradeError(''); }} placeholder="例如：History 201" /></label>
      <div className="grading-editor"><div className="grading-head"><span>评分分布</span><strong className={gradeRows.some((row) => row.name || row.weight) && Math.abs(gradeTotal - 100) > 0.001 ? 'total-warning' : ''}>合计 {gradeTotal}%</strong></div>{gradeRows.map((row) => <div className="grade-row" key={row.id}><input aria-label="评分项目名称" value={row.name} onChange={(event) => { setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item)); setGradeError(''); }} placeholder="例如：Midterm" /><select aria-label="评分项目类型" value={row.kind} onChange={(event) => setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, kind: event.target.value as 'exam' | 'task' } : item))}><option value="exam">考试</option><option value="task">任务</option></select><div className="weight-input"><input aria-label="评分比例" type="number" min="0.01" max="100" step="0.01" value={row.weight} onChange={(event) => { setGradeRows(gradeRows.map((item) => item.id === row.id ? { ...item, weight: event.target.value } : item)); setGradeError(''); }} placeholder="50" /><span>%</span></div><button type="button" aria-label="删除评分项目" onClick={() => setGradeRows(gradeRows.filter((item) => item.id !== row.id))}>×</button></div>)}<button type="button" className="add-grade" onClick={() => setGradeRows([...gradeRows, { id: Date.now(), name: '', weight: '', kind: 'task' }])}>＋ 添加评分项目</button>{gradeError && <p className="form-error">{gradeError}</p>}</div>
      <button className="add course-save">{editingCourse ? '保存课程修改' : '保存课程'}</button>
      {courses.length > 0 && <div className="course-list"><p>已有课程</p>{courses.map((course) => <div className="course-row" key={course.name}><div className="course-info"><span><strong>{course.name}</strong><small>{tasks.filter((task) => task.course === course.name).length} 项作业</small></span><p>{course.grading.length ? course.grading.map((item) => `${item.name}（${item.kind === 'exam' ? '考试' : '任务'}） ${item.weight}%`).join(' · ') : '尚未设置评分分布'}</p></div><div className="course-actions"><button type="button" className="course-edit" disabled={course.name === UNASSIGNED} onClick={() => editCourse(course)}>编辑课程</button><button type="button" className="course-delete" disabled={course.name === UNASSIGNED} title={course.name === UNASSIGNED ? '系统分类不能删除' : `删除 ${course.name}`} onClick={() => deleteCourse(course.name)}>{course.name === UNASSIGNED ? '保留' : '删除'}</button></div></div>)}</div>}
      <div className="actions"><button type="button" className="plain" onClick={closeCourseForm}>完成</button></div>
    </form></div>}

    {selectedTask && <div className="modal-backdrop" onMouseDown={() => setSelectedTask(null)}><section className="modal detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="detail-top"><div><p className="eyebrow">作业详情</p><h2>{selectedTask.title}</h2></div><button className="close" aria-label="关闭详情" onClick={() => setSelectedTask(null)}>×</button></div><div className="detail-meta"><span>{selectedTask.course}</span>{selectedTask.gradeCategory && <span>{selectedTask.gradeCategory}</span>}<span>{formatDate(selectedTask.due)}</span></div><div className="assignment-grade-editor"><p>成绩记录</p><div className="row"><label>任务类别<select disabled={!taskCategoriesFor(selectedTaskCourse).length} value={selectedTask.gradeCategory} onChange={(event) => setSelectedTask({ ...selectedTask, gradeCategory: event.target.value })}>{taskCategoriesFor(selectedTaskCourse).length ? taskCategoriesFor(selectedTaskCourse).map((category) => <option key={category.name}>{category.name}</option>) : <option value="">没有任务类别</option>}</select></label><label>成绩<div className="score-input"><input type="number" min="0" max="100" step="0.01" value={selectedTask.score ?? ''} onChange={(event) => setSelectedTask({ ...selectedTask, score: event.target.value === '' ? null : Number(event.target.value) })} placeholder="尚未评分" /><span>%</span></div></label></div><button className="secondary save-grade" onClick={saveSelectedTaskGrade}>保存成绩</button></div><div className="notes-block"><p>备注</p><div>{selectedTask.notes || '这项作业还没有备注。'}</div></div><div className="actions"><button className="add" onClick={() => setSelectedTask(null)}>完成查看</button></div></section></div>}
  </main>;
}
