import type { CanvasVideo, Course } from "./model";

export interface VideoCourseOption extends Course {
  canvasId?: number;
  teachingClassId?: number;
  sourceLabel: string;
}

const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();

export function normalizeVideoTermName(name: string): string {
  const seasons: Record<string, string> = { "1": "秋", "2": "春", "3": "夏", 一: "秋", 二: "春", 三: "夏" };
  return name.normalize("NFKC")
    .replace(/第?\s*([一二三123])\s*学期/g, (_, semester: string) => seasons[semester])
    .replace(/(20\d{2}\s*[-_/]\s*20\d{2})\s*[-_/]\s*([123])$/, (_, years: string, semester: string) => `${years} ${seasons[semester]}`)
    .replace(/Fall/gi, "秋").replace(/Spring/gi, "春").replace(/Summer/gi, "夏")
    .replace(/(20\d{2})\s*[-_/]\s*(20\d{2})\s*(?:学年)?\s*([秋春夏])/, "$1-$2 $3")
    .trim();
}

function termKey(name: string): string {
  const text = normalize(normalizeVideoTermName(name));
  const years = text.match(/(20\d{2})\D*(20\d{2})/);
  const semester = text.match(/第?([一二三123])学期/)?.[1]
    ?? text.match(/20\d{2}\D*20\d{2}[-_/]([123])$/)?.[1]
    ?? (/秋/.test(text) ? "1" : /春/.test(text) ? "2" : /夏/.test(text) ? "3" : undefined);
  return years && semester
    ? `${years[1]}-${years[2]}-${({ 一: "1", 二: "2", 三: "3" } as Record<string, string>)[semester] ?? semester}`
    : text;
}

export function compareVideoCourses(a: Course, b: Course): number {
  const rank = (name: string) => {
    const match = termKey(name).match(/^(20\d{2})-(20\d{2})-([123])$/);
    return match ? Number(match[1]) * 3 + Number(match[3]) : -1;
  };
  return rank(b.term.name) - rank(a.term.name)
    || a.name.localeCompare(b.name, "zh-CN", { numeric: true });
}

function matches(left: Course, right: Course): boolean {
  const term = termKey(left.term.name);
  if (!term || term !== termKey(right.term.name)) return false;

  const leftCourseCode = normalize(left.course_code);
  const rightCourseCode = normalize(right.course_code);
  if (leftCourseCode && rightCourseCode && leftCourseCode === rightCourseCode) return true;

  const teachers = new Set(left.teachers.map((teacher) => normalize(teacher.display_name)).filter(Boolean));
  const otherTeachers = right.teachers.map((teacher) => normalize(teacher.display_name)).filter(Boolean);
  const sameTeacher = otherTeachers.some((teacher) => teachers.has(teacher));
  if (teachers.size && otherTeachers.length && !sameTeacher) return false;
  if (normalize(left.name) !== normalize(right.name)) return false;
  return sameTeacher;
}

function sourceLabel(course: VideoCourseOption): string {
  if (course.canvasId !== undefined) return "";
  return course.teachingClassId !== undefined ? "视频空间" : "";
}

export function mergeVideoCourses(
  canvas: Course[],
  space: Course[],
): VideoCourseOption[] {
  const uniqueCanvas = [...new Map(canvas.map((course) => [course.id, course])).values()];
  const uniqueSpace = [...new Map(space.map((course) => [course.id, course])).values()];
  const usedIds = new Set(uniqueCanvas.map((course) => course.id));
  let nextSyntheticId = -1;
  const allocateId = () => {
    while (usedIds.has(nextSyntheticId)) nextSyntheticId -= 1;
    usedIds.add(nextSyntheticId);
    return nextSyntheticId--;
  };

  const result: VideoCourseOption[] = uniqueCanvas.map((course) => ({
    ...course,
    term: { ...course.term, name: normalizeVideoTermName(course.term.name) },
    canvasId: course.id,
    sourceLabel: "",
  }));

  const mergeSource = <T>(
    entries: T[],
    asCourse: (entry: T) => Course,
    attach: (course: VideoCourseOption, entry: T) => void,
    create: (entry: T, course: Course) => VideoCourseOption,
  ) => {
    const candidateIndexes = entries.map((entry) => result.flatMap((course, index) =>
      matches(course, asCourse(entry)) ? [index] : []));
    const targetCounts = new Map<number, number>();
    candidateIndexes.forEach((indexes) => indexes.forEach((index) =>
      targetCounts.set(index, (targetCounts.get(index) ?? 0) + 1)));

    entries.forEach((entry, entryIndex) => {
      const indexes = candidateIndexes[entryIndex];
      const target = indexes.length === 1 && targetCounts.get(indexes[0]) === 1
        ? indexes[0]
        : undefined;
      if (target !== undefined) {
        attach(result[target], entry);
        result[target].sourceLabel = sourceLabel(result[target]);
        return;
      }
      const course = asCourse(entry);
      const option = create(entry, course);
      option.id = allocateId();
      option.term = { ...option.term, name: normalizeVideoTermName(option.term.name) };
      option.sourceLabel = sourceLabel(option);
      result.push(option);
    });
  };

  mergeSource(
    uniqueSpace,
    (course) => course,
    (course, entry) => { course.teachingClassId = entry.id; },
    (entry) => ({ ...entry, teachingClassId: entry.id, sourceLabel: "" }),
  );
  return result;
}

export async function loadVideoCourse(
  course: VideoCourseOption,
  canvas: (id: number) => Promise<CanvasVideo[]>,
  space: (id: number) => Promise<CanvasVideo[]>,
  legacy: (id: number) => Promise<CanvasVideo[]> = async () => [],
): Promise<CanvasVideo[]> {
  const requests: Array<{ label: string; load: () => Promise<CanvasVideo[]> }> = [];
  if (course.canvasId !== undefined) {
    requests.push({ label: "Canvas", load: () => canvas(course.canvasId!) });
  }
  if (course.teachingClassId !== undefined) {
    requests.push({ label: "视频空间", load: () => space(course.teachingClassId!) });
  }
  if (course.canvasId !== undefined) {
    requests.push({ label: "旧版课堂视频", load: () => legacy(course.canvasId!) });
  }

  const results = await Promise.allSettled(requests.map((request) => request.load()));
  const errors: string[] = [];
  const videos: CanvasVideo[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") videos.push(...result.value);
    else {
      const message = String(result.reason);
      const unavailable = message.includes("当前课程暂未安排直录播")
        || message.includes("Teaching class id is missing");
      if (!unavailable) errors.push(`${requests[index].label}：${message}`);
    }
  });
  if (videos.length) {
    const seen = new Set<string>();
    return videos.filter((video) => {
      const digits = video.courseBeginTime.match(/\d+/g) ?? [];
      const [year] = digits;
      const time = digits.length >= 5 && year?.length === 4
        ? `${year}${digits.slice(1, 5).map((part) => part.padStart(2, "0")).join("")}`
        : "";
      // Canvas, video-space and legacy IDs belong to different namespaces.
      // The scheduled start minute is the stable cross-service identity for a
      // recording; request order makes the newer Canvas source win duplicates.
      const name = normalize(video.videoName);
      const end = normalize(video.courseEndTime);
      const key = time
        ? `time:${time}`
        : (name || end
          ? `fallback:${name}:${end}`
          : `id:${video.source}:${video.videoId}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (errors.length) throw new Error(errors.join("；"));
  return [];
}
