import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";
import {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { LoginAlertModal } from "../components/login_alert_modal";
import PreviewModal from "../components/preview_modal";
import { getConfig, saveConfig } from "./config";
import { BASE_URL, JI_BASE_URL } from "./constants";
import { appMessage } from "./message";
import {
  AnnualReport,
  Assignment,
  Course,
  Entry,
  File,
  Folder,
  LOG_LEVEL_ERROR,
  LoginMessage,
  ModuleItem,
  RelationshipTopo,
  User,
  UserSubmissions,
  isFile,
} from "./model";
import { ConfigDispatch, ConfigState, courseSlice } from "./store";
import { consoleLog, moduleItem2File } from "./utils";

const UPDATE_QRCODE_MESSAGE = '{ "type": "UPDATE_QR_CODE" }';
const SEND_INTERVAL = 1000 * 25;
const QRCODE_BASE_URL = "https://jaccount.sjtu.edu.cn/jaccount/confirmscancode";
const WEBSOCKET_BASE_URL = "wss://jaccount.sjtu.edu.cn/jaccount/sub";
const QRCODE_TIMEOUT = 1000 * 8;

const EMPTY_ARRAY: any[] = [];
const EMPTY_FILES: File[] = [];

export function usePreview(
  footer?: ReactNode,
  bodyStyle?: CSSProperties,
  monitorBlankKey = true
) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [previewEntry, setPreviewEntry] = useState<Entry | undefined>(
    undefined
  );
  const [hoveredEntry, setHoveredEntry] = useState<Entry | undefined>(
    undefined
  );

  const onHoverEntry = useCallback((entry: Entry) => {
    if (!previewEntry) {
      setHoveredEntry(entry);
    }
  }, [previewEntry]);

  const onLeaveEntry = useCallback(() => {
    if (!previewEntry) {
      setHoveredEntry(undefined);
    }
  }, [previewEntry]);

  const previewer = useMemo(
    () => (
      <Previewer
        previewEntry={previewEntry}
        setPreviewEntry={setPreviewEntry}
        hoveredEntry={hoveredEntry}
        setHoveredEntry={setHoveredEntry}
        entries={entries}
        footer={footer}
        bodyStyle={bodyStyle}
        monitorBlankKey={monitorBlankKey}
      />
    ),
    [bodyStyle, entries, footer, hoveredEntry, monitorBlankKey, previewEntry]
  );

  return {
    previewer,
    previewEntry,
    onHoverEntry,
    onLeaveEntry,
    setPreviewEntry,
    setEntries,
  };
}

// type FileType = File | undefined;
type EntryType = Entry | undefined;

function Previewer({
  previewEntry,
  setPreviewEntry,
  hoveredEntry,
  setHoveredEntry,
  entries,
  footer,
  bodyStyle,
  monitorBlankKey,
}: {
  previewEntry: EntryType;
  setPreviewEntry: Dispatch<SetStateAction<EntryType>>;
  hoveredEntry: EntryType;
  setHoveredEntry: Dispatch<SetStateAction<EntryType>>;
  entries: Entry[];
  footer?: ReactNode;
  bodyStyle?: CSSProperties;
  monitorBlankKey: boolean;
}) {
  const previewEntryRef = useRef<EntryType>(previewEntry);
  const hoveredEntryRef = useRef<EntryType>(hoveredEntry);
  const monitorBlankKeyRef = useRef(monitorBlankKey);

  useEffect(() => {
    previewEntryRef.current = previewEntry;
  }, [previewEntry]);

  useEffect(() => {
    hoveredEntryRef.current = hoveredEntry;
  }, [hoveredEntry]);

  useEffect(() => {
    monitorBlankKeyRef.current = monitorBlankKey;
  }, [monitorBlankKey]);

  const entryIndexMap = useMemo(() => {
    const map = new Map<Entry["id"], number>();
    entries.forEach((entry, index) => {
      map.set(entry.id, index);
    });
    return map;
  }, [entries]);

  const getNextEntry = useCallback((entry: Entry) => {
    const index = entryIndexMap.get(entry.id);
    if (index === -1) {
      return null;
    }
    if (index === undefined) {
      return null;
    }
    if (index === entries.length - 1) {
      return entries[0];
    }
    return entries[index + 1];
  }, [entries, entryIndexMap]);

  const getPrevEntry = useCallback((entry: Entry) => {
    const index = entryIndexMap.get(entry.id);
    if (index === -1) {
      return null;
    }
    if (index === undefined) {
      return null;
    }
    if (index === 0) {
      return entries[entries.length - 1];
    }
    return entries[index - 1];
  }, [entries, entryIndexMap]);

  useEffect(() => {
    const handleKeyDownEvent = (ev: KeyboardEvent) => {
      const currentPreviewEntry = previewEntryRef.current;
      const currentHoveredEntry = hoveredEntryRef.current;

      if (!monitorBlankKeyRef.current) {
        return;
      }
      const target = ev.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (ev.key === " " && !ev.repeat) {
        ev.stopPropagation();
        ev.preventDefault();
        if (currentHoveredEntry && !currentPreviewEntry) {
          setHoveredEntry(undefined);
          setPreviewEntry(currentHoveredEntry);
        } else if (currentPreviewEntry) {
          setPreviewEntry(undefined);
        }
        return;
      }
      if (!currentPreviewEntry) {
        return;
      }

      if (ev.key === "ArrowRight" && !ev.repeat) {
        ev.stopPropagation();
        ev.preventDefault();
        const entry = getNextEntry(currentPreviewEntry);
        if (entry) {
          setHoveredEntry(undefined);
          setPreviewEntry(entry);
        }
      }
      if (ev.key === "ArrowLeft" && !ev.repeat) {
        ev.stopPropagation();
        ev.preventDefault();
        const entry = getPrevEntry(currentPreviewEntry);
        if (entry) {
          setHoveredEntry(undefined);
          setPreviewEntry(entry);
        }
      }
    };

    document.body.addEventListener("keydown", handleKeyDownEvent, true);
    return () => {
      document.body.removeEventListener("keydown", handleKeyDownEvent, true);
    };
  }, [getNextEntry, getPrevEntry, setHoveredEntry, setPreviewEntry]);

  const currentFile = useMemo(() => {
    if (previewEntry && isFile(previewEntry)) {
      return previewEntry as File;
    }
    return undefined;
  }, [previewEntry]);

  const previewFiles = useMemo(() => {
    return currentFile ? [currentFile] : [];
  }, [currentFile]);

  const handleCancelPreview = useCallback(() => {
    setPreviewEntry(undefined);
  }, [setPreviewEntry]);

  const shouldOpen = previewEntry !== undefined && currentFile !== undefined;
  return (
    <>
      {shouldOpen && (
        <PreviewModal
          open={shouldOpen}
          files={previewFiles}
          footer={footer}
          bodyStyle={bodyStyle}
          title={currentFile.display_name}
          handleCancelPreview={handleCancelPreview}
        />
      )}
    </>
  );
}

export function useQRCode({
  onScanSuccess,
  onSavingChange,
}: {
  onScanSuccess?: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [uuid, setUuid] = useState<string>("");
  const [qrcode, setQrcode] = useState<string>("");
  const [wsURL, setWsURL] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasRetriedRef = useRef(false);
  const uuidRef = useRef("");
  const mountedRef = useRef(true);
  const loginPendingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { sendMessage, lastMessage, readyState } = useWebSocket(
    wsURL,
    undefined,
    wsURL.length > 0
  );

  const showQRCode = useCallback(async () => {
    setLoading(true);
    setError("");
    setQrcode("");
    hasRetriedRef.current = false;
    try {
      const nextUuid = await invoke<string | null>("get_uuid");
      if (!mountedRef.current) return;
      if (nextUuid) {
        uuidRef.current = nextUuid;
        setUuid(nextUuid);
        setWsURL(`${WEBSOCKET_BASE_URL}/${nextUuid}`);
        return;
      }
    } catch { /* Fall through to the retryable error. */ }
    if (mountedRef.current) {
      setLoading(false);
      setError("未能获取登录二维码，请检查网络后重试。");
    }
  }, []);

  const handleScanSuccess = async () => {
    if (!mountedRef.current || loginPendingRef.current) return;
    loginPendingRef.current = true;
    onSavingChange?.(true);
    try {
      const cookie = await invoke<string | null>("express_login", { uuid: uuidRef.current || uuid });
      if (!mountedRef.current) return;
      if (!cookie) {
        setError("扫码登录未完成，请重新扫码。");
        return;
      }
      const config = await getConfig(true);
      if (!mountedRef.current) return;
      await saveConfig({ ...config, ja_auth_cookie: cookie });
      if (mountedRef.current) onScanSuccess?.();
    } catch (e) {
      if (!mountedRef.current) return;
      setError("扫码登录未能保存，请重新扫码或稍后重试。");
      consoleLog(LOG_LEVEL_ERROR, e);
    } finally {
      loginPendingRef.current = false;
      if (mountedRef.current) onSavingChange?.(false);
    }
  };

  useEffect(() => {
    if (readyState == ReadyState.OPEN) {
      sendMessage(UPDATE_QRCODE_MESSAGE);
      const handle = setInterval(() => {
        refreshQRCode();
      }, SEND_INTERVAL);
      return () => {
        clearInterval(handle);
      };
    }
  }, [readyState]);

  useEffect(() => {
    if (!wsURL || readyState !== ReadyState.CLOSED || qrcode) {
      return;
    }
    setLoading(false);
    setError("二维码连接未建立成功，请重新获取。");
  }, [readyState, wsURL, qrcode]);

  useEffect(() => {
    if (lastMessage) {
      try {
        const loginMessage = JSON.parse(lastMessage.data) as LoginMessage;
        switch (loginMessage.type.toUpperCase()) {
          case "UPDATE_QR_CODE":
            handleUpdateQrcode(loginMessage);
            break;
          case "LOGIN":
            handleScanSuccess();
            break;
        }
      } catch (e) {
        consoleLog(LOG_LEVEL_ERROR, e);
      }
    }
  }, [lastMessage]);

  useEffect(() => {
    if (!loading || qrcode || !wsURL) {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (!hasRetriedRef.current) {
        hasRetriedRef.current = true;
        refreshQRCode();
        return;
      }
      setLoading(false);
      setError("二维码获取超时，请重新获取。");
    }, QRCODE_TIMEOUT);

    return () => window.clearTimeout(timeout);
  }, [loading, qrcode, wsURL]);

  const handleUpdateQrcode = (loginMessage: LoginMessage) => {
    const payload = loginMessage.payload;
    const qrcode = `${QRCODE_BASE_URL}?uuid=${uuidRef.current || uuid}&ts=${payload.ts}&sig=${payload.sig}`;
    setQrcode(qrcode);
    setLoading(false);
    setError("");
  };

  const refreshQRCode = () => {
    setLoading(true);
    setError("");
    sendMessage(UPDATE_QRCODE_MESSAGE);
  };

  return { qrcode, showQRCode, refreshQRCode, loading, error };
}

export function useLoginModal({ onLogin }: { onLogin?: () => void }) {
  const [open, setOpen] = useState<boolean>(false);
  const showModal = () => setOpen(true);
  const closeModal = () => setOpen(false);
  const modal = (
    <LoginAlertModal open={open} onCancelLogin={closeModal} onLogin={onLogin} />
  );

  return { modal, showModal, closeModal };
}

export function useData<T>(
  command: string,
  shouldFetch: boolean,
  args?: any,
  notifyOnError = true
) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [isLoading, setIsLoading] = useState(shouldFetch);

  const mutate = async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const data = (await invoke(command, args)) as T;
      setData(data);
    } catch (e) {
      consoleLog(LOG_LEVEL_ERROR, e);
      if (notifyOnError) appMessage().error(e as string);
      setError(e);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (shouldFetch) {
      mutate();
    }
  }, [command, args]);
  return {
    data,
    isLoading,
    error,
    mutate,
  };
}

export { useCourseSyllabus } from "./course_syllabus";

export function useCourses() {
  const courses = useData<Course[]>("list_courses", true);

  return {
    ...courses,
    data: courses.data ?? (EMPTY_ARRAY as Course[]),
  };
}

export function useTAOrTeacherCourses(notifyOnError = true) {
  const courses = useData<Course[]>("list_courses", true, undefined, notifyOnError);
  const data = useMemo(() => (courses.data ?? (EMPTY_ARRAY as Course[])).filter((course) =>
    course.enrollments.find(
      (enrollment) =>
        enrollment.role === "TaEnrollment" ||
        enrollment.role === "TeacherEnrollment"
    )
  ), [courses.data]);
  return {
    ...courses,
    data,
  };
}

export function useCurrentTermCourses() {
  const courses = useCourses();
  courses.data = courses.data.filter((course) => {
    const courseEnd = dayjs(course.term.end_at);
    const now = dayjs();
    return (
      now.isBefore(courseEnd) ||
      course.enrollments.find((enroll) => enroll.role === "TaEnrollment") !=
      undefined
    );
  });
  return courses;
}

export function useMe() {
  return useData<User>("get_me", true);
}

export function useUserSubmissions(
  courseId?: number,
  studentIds?: number[],
  notifyOnError = true
) {
  const args = useMemo(() => ({ courseId, studentIds }), [courseId, studentIds]);
  const shouldFetch = courseId != undefined && (studentIds?.length ?? 0) > 0;
  const submissions = useData<UserSubmissions[]>(
    "list_user_submissions",
    shouldFetch,
    args,
    notifyOnError
  );
  return {
    ...submissions,
    data: submissions.data ?? (EMPTY_ARRAY as UserSubmissions[]),
  };
}

export function useAssignments(courseId?: number, notifyOnError = true) {
  const args = useMemo(() => ({ courseId }), [courseId]);
  const shouldFetch = courseId != undefined;
  const assignments = useData<Assignment[]>(
    "list_course_assignments",
    shouldFetch,
    args,
    notifyOnError
  );
  return {
    ...assignments,
    data: assignments.data ?? (EMPTY_ARRAY as Assignment[]),
  };
}

export function useStudents(courseId?: number, notifyOnError = true) {
  const args = useMemo(() => ({ courseId }), [courseId]);
  const shouldFetch = courseId != undefined;
  const students = useData<User[]>("list_course_students", shouldFetch, args, notifyOnError);
  return {
    ...students,
    data: students.data ?? (EMPTY_ARRAY as User[]),
  };
}

export function useRelationship() {
  return useData<RelationshipTopo>("collect_relationship", true);
}

export function useFolderFiles(folderId?: number) {
  const [args, setArgs] = useState<any>({ folderId });
  useEffect(() => {
    setArgs({ folderId });
  }, [folderId]);
  const shouldFetch = folderId != undefined;
  return useData<File[]>("list_folder_files", shouldFetch, args);
}

export function useFolderFolders(folderId?: number) {
  const [args, setArgs] = useState<any>({ folderId });
  useEffect(() => {
    setArgs({ folderId });
  }, [folderId]);
  const shouldFetch = folderId != undefined;
  return useData<Folder[]>("list_folder_folders", shouldFetch, args);
}

export function useCourseFolders(courseId?: number) {
  const [args, setArgs] = useState<any>({ courseId });
  useEffect(() => {
    setArgs({ courseId });
  }, [courseId]);
  const shouldFetch = courseId != undefined;
  return useData<Folder[]>("list_course_folders", shouldFetch, args);
}

export const useKeyPress = (targetKey: string, action: () => void) => {
  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === targetKey) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener("keydown", keyHandler);

    return () => {
      window.removeEventListener("keydown", keyHandler);
    };
  }, [targetKey, action]);
};

export const useBaseURL = () => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [baseURL, setBaseURL] = useState<string>(BASE_URL);
  useEffect(() => {
    getConfig(true).then((config) => {
      if (config.account_type === "JI") {
        setBaseURL(JI_BASE_URL);
      }
      setIsLoading(false);
    });
  }, []);
  return { isLoading, data: baseURL };
};

export const useAnnualReport = (year: number) => {
  const [args, setArgs] = useState<any>({ year });
  useEffect(() => {
    setArgs({ year });
  }, [year]);
  return useData<AnnualReport>("generate_annual_report", true, args);
};

export const useConfigDispatch: () => ConfigDispatch = useDispatch;
export const useConfigSelector: TypedUseSelectorHook<ConfigState> = useSelector;

export function useSelectedCourse() {
  const selectedCourseId = useConfigSelector(
    (state) => state.course.selectedCourseId
  );
  const dispatch = useConfigDispatch();
  const setSelectedCourseId = useCallback(
    (courseId: number) =>
      dispatch(courseSlice.actions.setSelectedCourseId(courseId)),
    [dispatch]
  );
  return { selectedCourseId, setSelectedCourseId };
}

export function useAutoLoadCourse(
  load: (courseId: number) => void,
  ready?: boolean
) {
  const { selectedCourseId } = useSelectedCourse();
  const loadedRef = useRef(-1);
  useEffect(() => {
    if (
      ready !== false &&
      selectedCourseId > 0 &&
      loadedRef.current !== selectedCourseId
    ) {
      loadedRef.current = selectedCourseId;
      load(selectedCourseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId, ready]);
}

export function useExternalFiles(courseId?: number) {
  const [args, setArgs] = useState<any>({ courseId });
  useEffect(() => {
    setArgs({ courseId });
  }, [courseId]);
  const shouldFetch = courseId !== undefined && courseId !== -1;
  const { data,
    isLoading,
    error,
    mutate } = useData<ModuleItem[]>("list_external_module_items", shouldFetch, args);
  const externalFiles = useMemo(() =>
    data?.map(item => moduleItem2File(item))
      .filter(item => item.external_type === "File"),
    [data]);

  return {
    data: externalFiles ?? EMPTY_FILES,
    isLoading,
    error,
    mutate,
  };
}
