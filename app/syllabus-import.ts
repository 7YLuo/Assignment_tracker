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

export type SyllabusRecurrenceRule = {
  frequency: 'weekly' | 'biweekly';
  weekday: number;
  dueTime: string | null;
  firstDueDate: string | null;
};

export type SyllabusExpectedSeries = {
  title: string;
  category: string;
  count: number | null;
  notes: string;
  recurrence: SyllabusRecurrenceRule | null;
};

export type SyllabusImportResult = {
  courseName: string;
  courseStartDate: string | null;
  courseEndDate: string | null;
  grading: SyllabusGradeCategory[];
  assignments: SyllabusAssignment[];
  expectedSeries: SyllabusExpectedSeries[];
  warnings: string[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const duePattern = /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/;

function isNullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && datePattern.test(value));
}

export function isSyllabusImportResult(value: unknown): value is SyllabusImportResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<SyllabusImportResult>;
  return typeof result.courseName === 'string'
    && isNullableDate(result.courseStartDate)
    && isNullableDate(result.courseEndDate)
    && Array.isArray(result.grading)
    && result.grading.every((category) => category && typeof category.name === 'string' && (category.weight === null || typeof category.weight === 'number') && (category.kind === 'exam' || category.kind === 'task'))
    && Array.isArray(result.assignments)
    && result.assignments.every((assignment) => assignment && typeof assignment.title === 'string' && typeof assignment.category === 'string' && (assignment.dueAt === null || (typeof assignment.dueAt === 'string' && duePattern.test(assignment.dueAt))) && typeof assignment.notes === 'string')
    && Array.isArray(result.expectedSeries)
    && result.expectedSeries.every((series) => series
      && typeof series.title === 'string'
      && typeof series.category === 'string'
      && (series.count === null || (typeof series.count === 'number' && Number.isInteger(series.count) && series.count > 0))
      && typeof series.notes === 'string'
      && (series.recurrence === null || (
        (series.recurrence.frequency === 'weekly' || series.recurrence.frequency === 'biweekly')
        && Number.isInteger(series.recurrence.weekday)
        && series.recurrence.weekday >= 0
        && series.recurrence.weekday <= 6
        && (series.recurrence.dueTime === null || (typeof series.recurrence.dueTime === 'string' && timePattern.test(series.recurrence.dueTime)))
        && isNullableDate(series.recurrence.firstDueDate)
      )))
    && Array.isArray(result.warnings)
    && result.warnings.every((warning) => typeof warning === 'string');
}

export function normalizeSyllabusImportResult(value: unknown): SyllabusImportResult | null {
  if (isSyllabusImportResult(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const legacy = value as Partial<SyllabusImportResult>;
  const legacyIsValid = typeof legacy.courseName === 'string'
    && Array.isArray(legacy.grading)
    && legacy.grading.every((category) => category && typeof category.name === 'string' && (category.weight === null || typeof category.weight === 'number') && (category.kind === 'exam' || category.kind === 'task'))
    && Array.isArray(legacy.assignments)
    && legacy.assignments.every((assignment) => assignment && typeof assignment.title === 'string' && typeof assignment.category === 'string' && (assignment.dueAt === null || (typeof assignment.dueAt === 'string' && duePattern.test(assignment.dueAt))) && typeof assignment.notes === 'string')
    && Array.isArray(legacy.warnings)
    && legacy.warnings.every((warning) => typeof warning === 'string');
  return legacyIsValid ? {
    courseName: legacy.courseName as string,
    courseStartDate: null,
    courseEndDate: null,
    grading: legacy.grading as SyllabusGradeCategory[],
    assignments: legacy.assignments as SyllabusAssignment[],
    expectedSeries: [],
    warnings: legacy.warnings as string[],
  } : null;
}

export function syllabusExternalId(courseName: string, title: string, dueAt: string | null) {
  return `syllabus:${courseName}:${title}:${dueAt ?? 'tbd'}`.toLocaleLowerCase().replace(/\s+/g, '-');
}

export function expectedSeriesExternalId(courseName: string, title: string, category: string) {
  return `syllabus-series:${courseName}:${category}:${title}`.toLocaleLowerCase().replace(/\s+/g, '-');
}

function localDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function formatLocalDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function generateExpectedAssignments(series: SyllabusExpectedSeries, courseStartDate: string | null, courseEndDate: string | null) {
  const maximum = Math.min(series.count ?? 200, 200);
  const recurrence = series.recurrence;
  const startDate = recurrence?.firstDueDate ?? courseStartDate;
  if (!recurrence || !startDate || (!courseEndDate && !series.count) || (courseEndDate && courseEndDate < startDate)) {
    return Array.from({ length: series.count ? maximum : 0 }, (_, index) => ({
      title: `${series.title.trim()} ${index + 1}`,
      dueAt: null as string | null,
    }));
  }

  const cursor = localDate(startDate);
  const end = courseEndDate ? localDate(courseEndDate) : null;
  if (!recurrence.firstDueDate) {
    while (cursor.getDay() !== recurrence.weekday) cursor.setDate(cursor.getDate() + 1);
  }
  const step = recurrence.frequency === 'biweekly' ? 14 : 7;
  const assignments: Array<{ title: string; dueAt: string | null }> = [];
  while ((!end || cursor <= end) && assignments.length < maximum) {
    const date = formatLocalDate(cursor);
    assignments.push({
      title: `${series.title.trim()} ${assignments.length + 1}`,
      dueAt: recurrence.dueTime ? `${date}T${recurrence.dueTime}` : date,
    });
    cursor.setDate(cursor.getDate() + step);
  }
  return assignments;
}

export function formatRecurrenceRule(series: Pick<SyllabusExpectedSeries, 'count' | 'recurrence'>, courseStartDate: string | null, courseEndDate: string | null) {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  if (!series.recurrence) return series.count ? `预计 ${series.count} 项，截止时间待定` : '数量与截止时间待定';
  const cadence = series.recurrence.frequency === 'biweekly' ? '每两周' : '每周';
  const time = series.recurrence.dueTime ? ` ${series.recurrence.dueTime}` : '，未注明具体时间';
  const end = courseEndDate ? `，至 ${courseEndDate}` : '，课程结束日期待确认';
  const count = series.count ? `，最多 ${series.count} 项` : '';
  const start = series.recurrence.firstDueDate ?? courseStartDate;
  return `${cadence}${weekdays[series.recurrence.weekday]}${time}${start ? `，从 ${start} 起` : ''}${end}${count}`;
}

export function extractCourseCode(value: string) {
  const normalized = value.replace(/\u00a0/g, ' ').toLocaleUpperCase();
  const match = normalized.match(/\b([A-Z]{2,}(?:\s*[&/]\s*[A-Z]{2,})?)\s*[-–—:]?\s*(\d{2,4}[A-Z]?)\b/);
  if (!match || ['FALL', 'WINTER', 'SPRING', 'SUMMER'].includes(match[1])) return '';
  return `${match[1].replace(/\s+/g, ' ')} ${match[2]}`;
}
