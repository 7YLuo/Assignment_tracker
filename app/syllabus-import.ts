export type SyllabusGradeCategory = {
  name: string;
  weight: number | null;
  kind: 'exam' | 'task';
};

export type SyllabusAssignment = {
  title: string;
  category: string;
  dueAt: string | null;
  notes: string;
};

export type SyllabusImportResult = {
  courseName: string;
  grading: SyllabusGradeCategory[];
  assignments: SyllabusAssignment[];
  warnings: string[];
};

export function isSyllabusImportResult(value: unknown): value is SyllabusImportResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<SyllabusImportResult>;
  return typeof result.courseName === 'string'
    && Array.isArray(result.grading)
    && result.grading.every((category) => category && typeof category.name === 'string' && (category.weight === null || typeof category.weight === 'number') && (category.kind === 'exam' || category.kind === 'task'))
    && Array.isArray(result.assignments)
    && result.assignments.every((assignment) => assignment && typeof assignment.title === 'string' && typeof assignment.category === 'string' && (assignment.dueAt === null || (typeof assignment.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(assignment.dueAt))) && typeof assignment.notes === 'string')
    && Array.isArray(result.warnings)
    && result.warnings.every((warning) => typeof warning === 'string');
}

export function syllabusExternalId(courseName: string, title: string, dueAt: string | null) {
  return `syllabus:${courseName}:${title}:${dueAt ?? 'tbd'}`.toLocaleLowerCase().replace(/\s+/g, '-');
}

export function extractCourseCode(value: string) {
  const normalized = value.replace(/\u00a0/g, ' ').toLocaleUpperCase();
  const match = normalized.match(/\b([A-Z]{2,}(?:\s*[&/]\s*[A-Z]{2,})?)\s*[-–—:]?\s*(\d{2,4}[A-Z]?)\b/);
  if (!match || ['FALL', 'WINTER', 'SPRING', 'SUMMER'].includes(match[1])) return '';
  return `${match[1].replace(/\s+/g, ' ')} ${match[2]}`;
}
