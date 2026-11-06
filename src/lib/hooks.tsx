import { enqueuePDFMerge } from "./pdf_tasks";
import type { DownloadCourse } from "./downloads";
import { useTasks } from "./task_hooks";
import { isTaskActive, taskManager } from "./task_manager";
import {
  Button,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import dayjs from "dayjs";
import {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TypedUseSelectorHook, useDispatch, useSelector } from "react-redux";
import { ReadyState } from "react-use-websocket";
import { useOwnedQRCodeSocket } from "./useOwnedQRCodeSocket";
import { LoginAlertModal } from "../components/login_alert_modal";
import PreviewModal from "../components/preview_modal";
import { getConfig, isConfigOwnerCurrent, saveConfig, StaleConfigSessionError } from "./config";
import { BASE_URL, JI_BASE_URL } from "./constants";
import { appMessage } from "./message";
import {
  AnnualReport,
  AppConfig,
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
import {
  currentSession,
  isSessionCurrent,
  subscribeSession,
  useSessionEpoch,
} from "./session";
import { consoleLog, isMergableFileType, moduleItem2File } from "./utils";
import { usePreviewState } from "./preview_session";

const UPDATE_QRCODE_MESSAGE = '{ "type": "UPDATE_QR_CODE" }';
const SEND_INTERVAL = 1000 * 25;
const QRCODE_BASE_URL = "https://jaccount.sjtu.edu.cn/jaccount/confirmscancode";
const WEBSOCKET_BASE_URL = "wss://jaccount.sjtu.edu.cn/jaccount/sub";
const QRCODE_TIMEOUT = 1000 * 8;

const EMPTY_ARRAY: any[] = [];

export function usePreview(
  footer?: ReactNode,
  bodyStyle?: CSSProperties,
  monitorBlankKey = true
) {
  const session = useSessionEpoch();
  const [entries, setEntries] = usePreviewState<Entry[]>(session, EMPTY_ARRAY);
  const [previewEntry, setPreviewEntry] = usePreviewState<Entry | undefined>(session, undefined);
  const [hoveredEntry, setHoveredEntry] = usePreviewState<Entry | undefined>(session, undefined);

  const onHoverEntry = useCallback((entry: Entry) => {
    if (!previewEntry) {
      setHoveredEntry(entry);
    }
  }, [previewEntry, setHoveredEntry]);

  const onLeaveEntry = useCallback(() => {
    if (!previewEntry) {
      setHoveredEntry(undefined);
    }
  }, [previewEntry, setHoveredEntry]);

  const resetPreview = useCallback(() => {
    setPreviewEntry(undefined);
    setHoveredEntry(undefined);
  }, [setPreviewEntry, setHoveredEntry]);

  const previewer = useMemo(
    () => (
      <Previewer
        session={session}
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
    [bodyStyle, entries, footer, hoveredEntry, monitorBlankKey, previewEntry, session, setHoveredEntry, setPreviewEntry]
  );

  return {
    previewer,
    previewEntry,
    resetPreview,
    onHoverEntry,
    onLeaveEntry,
    setPreviewEntry,
    setEntries,
  };
}

// type FileType = File | undefined;
type EntryType = Entry | undefined;

function Previewer({
  session,
  previewEntry,
  setPreviewEntry,
  hoveredEntry,
  setHoveredEntry,
  entries,
  footer,
  bodyStyle,
  monitorBlankKey,
}: {
  session: number;
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
      if (!isSessionCurrent(session)) return;
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
  }, [getNextEntry, getPrevEntry, session, setHoveredEntry, setPreviewEntry]);

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
          ownerSession={session}
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

export function useMerger({
  setPreviewEntry,
  onHoverEntry,
  onLeaveEntry,
  course,
}: {
  setPreviewEntry: Dispatch<SetStateAction<EntryType>>;
  onHoverEntry: (entry: Entry) => void;
  onLeaveEntry: () => void;
  course?: DownloadCourse;
}) {
  const tasks = useTasks();
  const session = useSessionEpoch();
  const latest = [...tasks].reverse().find((task) => task.kind === "pdf-merge");
  const canPreviewResult = latest?.ownerSession === session;
  const [outFileName, setOutFileName] = useState("");
  const result = useMemo(() => latest?.result ? ({
    url: latest.result.url, display_name: latest.result.name,
  } as File) : undefined, [latest?.result]);
  const mergePDFs = async (files: File[]) => {
    const selected = files.filter((file) => isMergableFileType(file.display_name));
    if (selected.length < 2) {
      appMessage().warning("请选择至少两个可合并的文件。");
      return;
    }
    if (tasks.some((task) => task.kind === "pdf-merge" && isTaskActive(task))) {
      appMessage().warning("请等待当前合并任务执行完毕。");
      return;
    }
    const name = outFileName.trim().replace(/[\\/:*?"<>|]/g, "_") || `merged_${Date.now()}`;
    enqueuePDFMerge(selected, `${name}.pdf`, course);
  };
  const progress = (
    <Stack spacing={1}>
      <Typography variant="body2" color={latest?.status === "failed" ? "error" : "text.secondary"}>
        {latest?.error ?? latest?.stage ?? "当前无任务"}
      </Typography>
      <LinearProgress
        variant={latest && isTaskActive(latest) && latest.progress === undefined ? "indeterminate" : "determinate"}
        value={latest?.progress ?? 0}
        color={latest?.status === "failed" ? "error" : "primary"}
      />
      {latest?.status === "failed" && <Button onClick={() => taskManager.retry(latest.id)}>重试合并</Button>}
      {latest?.actionError && <Typography color="error">{latest.actionError}</Typography>}
    </Stack>
  );
  const handleDownloadResult = () => latest ? taskManager.action(latest.id, "save") : undefined;

  const merger = (
    <Stack spacing={2} sx={{ width: "100%" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary">
          自定义文件名：
        </Typography>
        <TextField
          size="small"
          fullWidth
          onChange={(e) => setOutFileName(e.target.value)}
          placeholder="请输入自定义文件名"
          InputProps={{
            endAdornment: <Typography variant="caption" color="text.secondary">.pdf</Typography>,
          }}
        />
      </Stack>
      {progress}
      {result && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
          <a
            onMouseEnter={canPreviewResult ? () => onHoverEntry(result) : undefined}
            onMouseLeave={onLeaveEntry}
          >
            {result.display_name}
          </a>
          {canPreviewResult && <Button variant="outlined" onClick={() => setPreviewEntry(result)}>预览</Button>}
          <Button variant="contained" onClick={handleDownloadResult}>下载</Button>
        </Stack>
      )}
    </Stack>
  );

  return { merger, mergePDFs };
}

export function useQRCode({ onScanSuccess }: { onScanSuccess?: () => void }) {
  const [uuid, setUuid] = useState<string>("");
  const [qrcode, setQrcode] = useState<string>("");
  const [wsURL, setWsURL] = useState<string>("");
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const hasRetriedRef = useRef(false);
  const uuidRef = useRef("");
  const uuidRequestRef = useRef(0);
  const qrIntentRef = useRef(0);
  const connectionOwnerRef = useRef<{ session: number; request: number; uuid: string; url: string; config: AppConfig } | null>(null);
  const invalidatedSocketsRef = useRef(new WeakSet<object>());
  useEffect(() => {
    const invalidate = () => {
      const previousSocket = getWebSocket();
      if (previousSocket) invalidatedSocketsRef.current.add(previousSocket);
      uuidRequestRef.current += 1;
      connectionOwnerRef.current = null;
      uuidRef.current = "";
      setUuid("");
      setWsURL("");
      setQrcode("");
      setLoading(false);
      setError("");
    };
    const unsubscribe = subscribeSession(invalidate);
    return () => {
      qrIntentRef.current += 1;
      unsubscribe();
      uuidRequestRef.current += 1;
      connectionOwnerRef.current = null;
    };
  }, []);
  const { sendMessage, lastMessage, readyState, getWebSocket, connectionFailed } = useOwnedQRCodeSocket(
    wsURL,
    connectionGeneration,
    wsURL.length > 0
  );

  const ownsConnection = (
    connection: typeof connectionOwnerRef.current,
    socket: ReturnType<typeof getWebSocket>
  ) => Boolean(connection && socket
    && connectionOwnerRef.current === connection
    && isSessionCurrent(connection.session)
    && isConfigOwnerCurrent(connection.config)
    && connection.request === uuidRequestRef.current
    && connection.uuid === uuidRef.current
    && socket === getWebSocket()
    && !invalidatedSocketsRef.current.has(socket)
    && socket.url === connection.url);

  const showQRCode = useCallback(async () => {
    const intent = ++qrIntentRef.current;
    const previousSocket = getWebSocket();
    if (previousSocket) invalidatedSocketsRef.current.add(previousSocket);
    uuidRequestRef.current += 1;
    connectionOwnerRef.current = null;
    uuidRef.current = "";
    setUuid("");
    setWsURL("");
    setQrcode("");
    setLoading(true);
    setError("");
    hasRetriedRef.current = false;
    let owns = () => intent === qrIntentRef.current;
    try {
      const sourceConfig = { ...await getConfig(true) };
      if (!owns() || !isConfigOwnerCurrent(sourceConfig)) return;
      const request = ++uuidRequestRef.current;
      const session = currentSession();
      owns = () => intent === qrIntentRef.current
        && request === uuidRequestRef.current
        && isSessionCurrent(session)
        && isConfigOwnerCurrent(sourceConfig);
      setLoading(true);
      const nextUuid = (await invoke("get_uuid")) as string | null;
      if (!owns()) return;
      if (nextUuid) {
        uuidRef.current = nextUuid;
        connectionOwnerRef.current = { session, request, uuid: nextUuid, url: `${WEBSOCKET_BASE_URL}/${nextUuid}`, config: sourceConfig };
        setConnectionGeneration(request);
        setUuid(nextUuid);
        setWsURL(`${WEBSOCKET_BASE_URL}/${nextUuid}`);
        return;
      }
      setLoading(false);
      setError("未能获取登录二维码标识，请稍后重试。");
    } catch (error) {
      if (!owns() || error instanceof StaleConfigSessionError) return;
      setLoading(false);
      setError("未能获取登录二维码标识，请稍后重试。");
    }
  }, []);

  const handleScanSuccess = async () => {
    const connection = connectionOwnerRef.current;
    if (!connection || !isSessionCurrent(connection.session)
        || connection.request !== uuidRequestRef.current
        || connection.uuid !== uuidRef.current) return;
    const owner = currentSession();
    const request = uuidRequestRef.current;
    const requestedUuid = uuidRef.current || uuid;
    const owns = () => isSessionCurrent(owner)
      && request === uuidRequestRef.current
      && requestedUuid === (uuidRef.current || uuid)
      && isConfigOwnerCurrent(connection.config);
    const config = connection.config;
    try {
      const JAAuthCookie = (await invoke("express_login", { uuid: requestedUuid })) as string | null;
      if (!owns() || !JAAuthCookie) return;
      const nextConfig = { ...config, ja_auth_cookie: JAAuthCookie };
      await saveConfig(nextConfig, {
        isCurrent: owns,
        onCommitted: () => onScanSuccess?.(),
      });
    } catch {
      if (!owns()) return;
      appMessage().error("登录失败，请重新获取二维码后重试。");
    }
  };

  useEffect(() => {
    const connection = connectionOwnerRef.current;
    const socket = getWebSocket();
    if (readyState !== ReadyState.OPEN || !ownsConnection(connection, socket)) return;
    sendMessage(UPDATE_QRCODE_MESSAGE, false);
    const handle = setInterval(() => {
      if (!ownsConnection(connection, socket)) return;
      refreshQRCode();
    }, SEND_INTERVAL);
    return () => clearInterval(handle);
  }, [readyState, wsURL, uuid]);

  useEffect(() => {
    if (!wsURL || readyState !== ReadyState.CLOSED || qrcode) {
      return;
    }
    const owner = connectionOwnerRef.current;
    if (!owner || !isSessionCurrent(owner.session)
        || owner.request !== uuidRequestRef.current
        || owner.uuid !== uuidRef.current) return;
    if (!connectionFailed && !ownsConnection(owner, getWebSocket())) return;
    setLoading(false);
    setError("二维码连接未建立成功，请重新获取。");
  }, [readyState, wsURL, qrcode, connectionFailed, connectionGeneration]);

  useEffect(() => {
    if (lastMessage) {
      const connection = connectionOwnerRef.current;
      const socket = getWebSocket();
      if (!connection || !isSessionCurrent(connection.session)
          || connection.request !== uuidRequestRef.current
          || connection.uuid !== uuidRef.current
          || !socket || invalidatedSocketsRef.current.has(socket) || lastMessage.target !== socket
          || socket.url !== connection.url) return;
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
        consoleLog(LOG_LEVEL_ERROR, "QR message processing failed");
      }
    }
  }, [lastMessage]);

  useEffect(() => {
    if (!loading || qrcode || !wsURL || readyState !== ReadyState.OPEN) return;
    const connection = connectionOwnerRef.current;
    const socket = getWebSocket();
    if (!ownsConnection(connection, socket)) return;
    let timeout: number;
    const onTimeout = () => {
      if (!ownsConnection(connection, socket)) return;
      if (!hasRetriedRef.current) {
        hasRetriedRef.current = true;
        refreshQRCode();
        timeout = window.setTimeout(onTimeout, QRCODE_TIMEOUT);
        return;
      }
      setLoading(false);
      setError("二维码获取超时，请重新获取。");
    };
    timeout = window.setTimeout(onTimeout, QRCODE_TIMEOUT);
    return () => window.clearTimeout(timeout);
  }, [loading, qrcode, wsURL, uuid, readyState]);

  const handleUpdateQrcode = (loginMessage: LoginMessage) => {
    const payload = loginMessage.payload;
    const qrcode = `${QRCODE_BASE_URL}?uuid=${uuidRef.current || uuid}&ts=${payload.ts}&sig=${payload.sig}`;
    setQrcode(qrcode);
    setLoading(false);
    setError("");
  };

  const refreshQRCode = () => {
    if (readyState !== ReadyState.OPEN || !ownsConnection(connectionOwnerRef.current, getWebSocket())) return;
    setLoading(true);
    setError("");
    sendMessage(UPDATE_QRCODE_MESSAGE, false);
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

export function useData<T>(command: string, shouldFetch: boolean, args?: Record<string, unknown>, sourceSession?: number) {
  const session = useSessionEpoch();
  const owner = sourceSession ?? session;
  const source = useMemo(() => ({ command, args, session: owner, shouldFetch }), [command, args, owner, shouldFetch]);
  const activeSource = useRef<typeof source>();
  const latestRequest = useRef(0);
  const [state, setState] = useState<{
    source: typeof source; data?: T; error?: unknown; isLoading: boolean;
  }>();

  // Bind callbacks to the committed source, not to whichever account happens
  // to be current when an old callback is eventually invoked.
  useLayoutEffect(() => {
    activeSource.current = source;
    return () => { if (activeSource.current === source) activeSource.current = undefined; };
  }, [source]);
  useEffect(() => {
    setState((previous) => previous?.source === source && isSessionCurrent(source.session) ? previous : undefined);
  }, [source, session]);

  const mutate = useCallback(async () => {
    if (activeSource.current !== source || !isSessionCurrent(source.session)) return;
    const request = ++latestRequest.current;
    const owns = () => activeSource.current === source && isSessionCurrent(source.session)
      && latestRequest.current === request;
    setState((previous) => owns() ? { source, data: previous?.source === source ? previous.data : undefined, isLoading: true } : previous);
    try {
      const data = await invoke<T>(source.command, source.args);
      if (owns()) setState((previous) => owns() ? { source, data, isLoading: false } : previous);
    } catch (error) {
      if (!owns()) return;
      consoleLog(LOG_LEVEL_ERROR, "Data request failed");
      appMessage().error(error as string);
      setState((previous) => owns() ? { source, data: previous?.source === source ? previous.data : undefined, error, isLoading: false } : previous);
    }
  }, [source]);

  useEffect(() => {
    if (shouldFetch) void mutate();
  }, [mutate, shouldFetch]);
  // Mask synchronously: a child effect must never copy an old account or
  // folder's data during the render before passive cleanup runs.
  const current = owner === session && state?.source === source ? state : undefined;
  return { data: current?.data, error: current?.error, isLoading: current?.isLoading ?? false, mutate };
}

export { useCourseSyllabus } from "./course_syllabus";

export function useCourses() {
  const courses = useData<Course[]>("list_courses", true);

  return {
    ...courses,
    data: courses.data ?? (EMPTY_ARRAY as Course[]),
  };
}

export function useTAOrTeacherCourses() {
  const courses = useData<Course[]>("list_courses", true);
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

// Account-scoped IDs retain their selection owner. A session wake alone must
// not reauthorize an old course/folder ID; select again or remount its page.
export function useUserSubmissions(courseId?: number, studentIds?: number[]) {
  const source = useMemo(() => ({ args: { courseId, studentIds }, session: currentSession() }), [courseId, studentIds]);
  const shouldFetch = courseId != undefined && (studentIds?.length ?? 0) > 0;
  const submissions = useData<UserSubmissions[]>(
    "list_user_submissions",
    shouldFetch,
    source.args, source.session
  );
  return {
    ...submissions,
    data: submissions.data ?? (EMPTY_ARRAY as UserSubmissions[]),
  };
}

export function useAssignments(courseId?: number) {
  const source = useMemo(() => ({ args: { courseId }, session: currentSession() }), [courseId]);
  const shouldFetch = courseId != undefined;
  const assignments = useData<Assignment[]>(
    "list_course_assignments",
    shouldFetch,
    source.args, source.session
  );
  return {
    ...assignments,
    data: assignments.data ?? (EMPTY_ARRAY as Assignment[]),
  };
}

export function useStudents(courseId?: number) {
  const source = useMemo(() => ({ args: { courseId }, session: currentSession() }), [courseId]);
  const shouldFetch = courseId != undefined;
  const students = useData<User[]>("list_course_students", shouldFetch, source.args, source.session);
  return {
    ...students,
    data: students.data ?? (EMPTY_ARRAY as User[]),
  };
}

export function useRelationship() {
  return useData<RelationshipTopo>("collect_relationship", true);
}

export function useFolderFiles(folderId?: number) {
  const source = useMemo(() => ({ args: { folderId }, session: currentSession() }), [folderId]);
  const shouldFetch = folderId != undefined;
  return useData<File[]>("list_folder_files", shouldFetch, source.args, source.session);
}

export function useFolderFolders(folderId?: number) {
  const source = useMemo(() => ({ args: { folderId }, session: currentSession() }), [folderId]);
  const shouldFetch = folderId != undefined;
  return useData<Folder[]>("list_folder_folders", shouldFetch, source.args, source.session);
}

export function useCourseFolders(courseId?: number) {
  const source = useMemo(() => ({ args: { courseId }, session: currentSession() }), [courseId]);
  const shouldFetch = courseId != undefined;
  return useData<Folder[]>("list_course_folders", shouldFetch, source.args, source.session);
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
  const session = useSessionEpoch();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [baseURL, setBaseURL] = useState<string>(BASE_URL);
  useEffect(() => {
    const owner = currentSession();
    let active = true;
    const ownsRequest = () => active && isSessionCurrent(owner);
    setIsLoading(true);
    setBaseURL(BASE_URL);
    void getConfig(true).then((config) => {
      if (!ownsRequest()) return;
      if (config.account_type === "JI") {
        setBaseURL(JI_BASE_URL);
      }
      setIsLoading(false);
    }).catch((error: unknown) => {
      if (error instanceof StaleConfigSessionError || !ownsRequest()) return;
      console.error("Failed to load base URL:", error);
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [session]);
  return { isLoading, data: baseURL };
};

export const useAnnualReport = (year: number) => {
  const args = useMemo(() => ({ year }), [year]);
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
  const session = useSessionEpoch();
  const loadedRef = useRef(-1);
  useEffect(() => {
    // The new account must load its own course, even when the id happens to
    // match the one the previous account had selected.
    loadedRef.current = -1;
  }, [session]);
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
  const source = useMemo(() => ({ args: { courseId }, session: currentSession() }), [courseId]);
  const shouldFetch = courseId !== undefined && courseId !== -1;
  const { data,
    isLoading,
    error,
    mutate } = useData<ModuleItem[]>("list_external_module_items", shouldFetch, source.args, source.session);
  const externalFiles = useMemo(() =>
    data?.map(item => moduleItem2File(item))
      .filter(item => item.external_type === "File"),
    [data]);

  return {
    data: externalFiles ?? [],
    isLoading,
    error,
    mutate,
  };
}
