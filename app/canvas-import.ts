export type CanvasGradeCategory = {
  name: string;
  weight: number;
  kind: 'exam' | 'task';
};

export type CanvasImportCourse = {
  externalId: string;
  name: string;
  grading: CanvasGradeCategory[];
};

export type CanvasImportAssignment = {
  externalId: string;
  courseExternalId: string;
  title: string;
  due: string;
  notes: string;
  gradeCategory: string;
  submitted: boolean;
  score: number | null;
};

export type CanvasImportPayload = {
  provider: 'mock';
  importedAt: string;
  courses: CanvasImportCourse[];
  assignments: CanvasImportAssignment[];
};

export const mockCanvasCourses: CanvasImportCourse[] = [
  {
    externalId: 'canvas-demo-course-stats-250',
    name: 'STATS 250',
    grading: [
      { name: 'Exams', weight: 50, kind: 'exam' },
      { name: 'Homework', weight: 35, kind: 'task' },
      { name: 'Labs', weight: 15, kind: 'task' },
    ],
  },
  {
    externalId: 'canvas-demo-course-eecs-280',
    name: 'EECS 280',
    grading: [
      { name: 'Exams', weight: 40, kind: 'exam' },
      { name: 'Projects', weight: 45, kind: 'task' },
      { name: 'Labs', weight: 15, kind: 'task' },
    ],
  },
];

const mockCanvasAssignments: CanvasImportAssignment[] = [
  {
    externalId: 'canvas-demo-assignment-stats-hw-3',
    courseExternalId: 'canvas-demo-course-stats-250',
    title: 'Homework 3',
    due: '2026-09-13T23:59',
    notes: 'Canvas 模拟数据：完成题目后上传 PDF。',
    gradeCategory: 'Homework',
    submitted: false,
    score: null,
  },
  {
    externalId: 'canvas-demo-assignment-stats-lab-2',
    courseExternalId: 'canvas-demo-course-stats-250',
    title: 'Lab 2',
    due: '2026-09-11T17:00',
    notes: 'Canvas 模拟数据：在实验课结束前提交。',
    gradeCategory: 'Labs',
    submitted: false,
    score: null,
  },
  {
    externalId: 'canvas-demo-assignment-eecs-project-1',
    courseExternalId: 'canvas-demo-course-eecs-280',
    title: 'Project 1',
    due: '2026-09-20T23:59',
    notes: 'Canvas 模拟数据：提交代码并通过自动测试。',
    gradeCategory: 'Projects',
    submitted: false,
    score: null,
  },
  {
    externalId: 'canvas-demo-assignment-eecs-lab-3',
    courseExternalId: 'canvas-demo-course-eecs-280',
    title: 'Lab 3',
    due: '2026-09-12T23:59',
    notes: 'Canvas 模拟数据：完成实验检查点。',
    gradeCategory: 'Labs',
    submitted: true,
    score: 96.5,
  },
];

export const mockCanvasAssignmentCount = mockCanvasAssignments.length;

export async function fetchMockCanvasImport(): Promise<CanvasImportPayload> {
  await new Promise((resolve) => window.setTimeout(resolve, 450));
  return {
    provider: 'mock',
    importedAt: new Date().toISOString(),
    courses: mockCanvasCourses.map((course) => ({ ...course, grading: course.grading.map((category) => ({ ...category })) })),
    assignments: mockCanvasAssignments.map((assignment) => ({ ...assignment })),
  };
}
