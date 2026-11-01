import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { consoleLog } from "./diagnostics";
import { isSessionCurrent, useSessionEpoch } from "./session";
import { LOG_LEVEL_ERROR, type Course } from "./model";

interface SyllabusState {
  courseId?: number;
  session?: number;
  data?: Course;
  error?: unknown;
  isLoading: boolean;
}

export function useCourseSyllabus(courseId?: number) {
  const session = useSessionEpoch();
  const [state, setState] = useState<SyllabusState>({ isLoading: false });
  const [revision, setRevision] = useState(0);
  const mutate = useCallback(() => setRevision((value) => value + 1), []);
  const shouldFetch = courseId !== undefined && courseId > 0;

  useEffect(() => {
    if (!shouldFetch || !isSessionCurrent(session)) return;
    let active = true;
    setState({ courseId, session, isLoading: true });
    invoke<Course>("get_course_syllabus", { courseId }).then(
      (data) => {
        if (active && isSessionCurrent(session)) setState({ courseId, session, data, isLoading: false });
      },
      (error: unknown) => {
        if (!active || !isSessionCurrent(session)) return;
        // Keep technical details in diagnostics; the page owns the user-facing error.
        consoleLog(LOG_LEVEL_ERROR, error);
        setState({ courseId, session, error, isLoading: false });
      },
    );
    return () => { active = false; };
  }, [courseId, shouldFetch, revision, session]);

  const current = !shouldFetch
    ? { isLoading: false }
    : state.courseId === courseId && state.session === session && isSessionCurrent(session) ? state : { isLoading: true };
  return { data: undefined, error: undefined, ...current, mutate };
}
