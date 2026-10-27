import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { consoleLog } from "./diagnostics";
import { LOG_LEVEL_ERROR, type Course } from "./model";

interface SyllabusState {
  courseId?: number;
  data?: Course;
  error?: unknown;
  isLoading: boolean;
}

export function useCourseSyllabus(courseId?: number) {
  const [state, setState] = useState<SyllabusState>({ isLoading: false });
  const [revision, setRevision] = useState(0);
  const mutate = useCallback(() => setRevision((value) => value + 1), []);
  const shouldFetch = courseId !== undefined && courseId > 0;

  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    setState({ courseId, isLoading: true });
    invoke<Course>("get_course_syllabus", { courseId }).then(
      (data) => {
        if (active) setState({ courseId, data, isLoading: false });
      },
      (error: unknown) => {
        if (!active) return;
        // Keep technical details in diagnostics; the page owns the user-facing error.
        consoleLog(LOG_LEVEL_ERROR, error);
        setState({ courseId, error, isLoading: false });
      },
    );
    return () => { active = false; };
  }, [courseId, shouldFetch, revision]);

  const current = !shouldFetch
    ? { isLoading: false }
    : state.courseId === courseId ? state : { isLoading: true };
  return { data: undefined, error: undefined, ...current, mutate };
}
