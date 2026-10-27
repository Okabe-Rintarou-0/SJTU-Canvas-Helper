import { invoke } from "@tauri-apps/api/core";
import { LOG_LEVEL_ERROR, type LogLevel } from "./model";

const MAX_DEPTH = 5;
const MAX_ITEMS = 30;
const MAX_NODES = 200;
const MAX_STRING_LENGTH = 4000;
export const MAX_DIAGNOSTIC_LENGTH = 16000;
const REDACTED = "[redacted]";
const ACCESSOR_OMITTED = "[Accessor omitted]";
const diagnosticMarkers = new Set([REDACTED, ACCESSOR_OMITTED, "[Items truncated]", "[Depth limit]", "[Node limit]", "[Circular]", "[Unserializable value]", "[Function]", "[truncated]"]);

// Explicit aliases from Canvas/video models; avoid broad *name/*id matches that hide diagnostics.
const nameFields = new Set([
  "name", "title", "displayname", "sortablename", "shortname", "fullname", "realname", "nickname",
  "filename", "outputname", "savename", "externaltitle", "contextname", "assignmentname", "assignmetname",
  "username", "authorname", "studentname", "studentnames", "teachername", "teachernames", "teacname", "teacnames", "tecname",
  "instructorname", "instructornames", "coursename", "coursenames", "subjectname", "subjname", "courname", "teclname", "teachingclassname",
  "videoname", "videname", "classroomname", "clroname", "organizationname",
  "姓名", "名称", "标题", "显示名", "昵称", "用户名", "用户姓名", "学生姓名", "学生名字", "学生名单",
  "教师姓名", "教师名", "任课教师姓名", "老师姓名", "授课教师", "教师",
  "课程名", "课程名称", "教学班名称", "班级名称", "文件名", "文件名称",
]);
const privateFields = new Set([
  ...nameFields,
  "contextcode", "loginid", "loginuserid", "sisuserid", "sisloginid", "email",
  "userid", "userids", "authorid", "editorid", "anonymousid", "studentid", "studentids", "studentno", "studentnumber", "studentnum", "sno",
  "teacherid", "teacherids", "teacherno", "instructorid", "employeeid", "employeeno", "workno",
  "courseid", "courseids", "canvasid", "canvascourseid", "coursecode", "courseno",
  "subjid", "courid", "teclid", "teclcode", "teachingclassid", "libraryid", "spaceid", "currentaccount", "allaccounts",
  "用户id", "用户编号", "邮箱", "电子邮箱", "学号", "学生学号", "学生编号", "学生id",
  "教师id", "教师编号", "教师工号", "工号", "教工号",
  "课程id", "课程编号", "课程代码", "课号", "教学班id", "教学班编号",
]);
const identityContainers = new Set([
  "user", "users", "userinfo", "student", "students", "studentinfo", "teacher", "teachers", "teacherinfo",
  "author", "authors", "instructor", "instructors", "participant", "participants", "person", "people",
  "course", "courses", "courseinfo", "teachingclass", "teachingclasses", "account", "accounts",
  "用户", "学生", "教师", "任课教师", "人员", "成员", "课程", "课程列表", "教学班",
]);
const personNameContainers = new Set([
  "student", "students", "studentinfo", "teacher", "teachers", "teacherinfo", "author", "authors",
  "instructor", "instructors", "participant", "participants", "person", "people", "学生", "教师", "任课教师", "人员", "成员",
]);
const genericIdentityFields = new Set(["id", "ids", "key", "uuid"]);
const standardErrorNames = new Set(["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError", "InternalError"]);

function fieldKey(key: string): string {
  return key.normalize("NFKC").replace(/[\s_-]/g, "").toLowerCase();
}

function redactName(value: unknown): string {
  if (typeof value !== "string") return REDACTED;
  const trimmed = value.trimStart();
  if (diagnosticMarkers.has(trimmed)) return trimmed;
  if (trimmed === "[personal data omitted]") return REDACTED;
  const first = trimmed.codePointAt(0);
  if (first === undefined || first <= 0x1f || (first >= 0x7f && first <= 0x9f)
    || (first >= 0xd800 && first <= 0xdfff) || first === 0x22 || first === 0x27 || first === 0x5c) return REDACTED;
  return String.fromCodePoint(first) + REDACTED;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const suffix = "…[truncated]";
  const prefix = value.slice(0, limit - suffix.length).replace(/[\uD800-\uDBFF]$/, "");
  return prefix + suffix;
}

/** Avoid toJSON methods and ordinary object getters while reporting another failure. */
export function serializeDiagnostic(value: unknown): string {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const normalize = (item: unknown, depth: number, identityContext = false, nameContext = false): unknown => {
    if (++nodes > MAX_NODES) return "[Node limit]";
    if (nameContext && (item === null || typeof item !== "object")) return redactName(item);
    if (identityContext && (item === null || typeof item !== "object")) return REDACTED;
    if (typeof item === "string") return truncate(item, MAX_STRING_LENGTH);
    if (item == null || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item !== "object") return typeof item === "function" ? "[Function]" : String(item);
    if (seen.has(item)) return "[Circular]";
    if (depth >= MAX_DEPTH) return "[Depth limit]";
    seen.add(item);
    try {
      if (!nameContext && item instanceof Error) {
        const originalName = item.name;
        const name = standardErrorNames.has(originalName) ? originalName : "Error";
        let stack = item.stack;
        if (name !== originalName && typeof stack === "string") {
          // Custom error names can contain a person's name; the message is retained separately.
          stack = stack.replace(/^[^\r\n]*/, "Error");
          if (typeof originalName === "string" && originalName) stack = stack.split(originalName).join("Error");
        }
        return {
          name,
          message: normalize(item.message, depth + 1),
          stack: normalize(stack, depth + 1),
          ...("cause" in item ? { cause: normalize((item as Error & { cause: unknown }).cause, depth + 1) } : {}),
        };
      }
      if (Array.isArray(item)) {
        const entries: unknown[] = [];
        for (let index = 0; index < Math.min(item.length, MAX_ITEMS); index++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          entries.push(descriptor && "value" in descriptor ? normalize(descriptor.value, depth + 1, identityContext, nameContext) : ACCESSOR_OMITTED);
        }
        if (item.length > MAX_ITEMS) entries.push("[Items truncated]");
        return entries;
      }
      const result: Record<string, unknown> = Object.create(null);
      const keys = Object.keys(item);
      const boundedKeys = keys.slice(0, MAX_ITEMS);
      const businessObject = identityContext || boundedKeys.some((key) => privateFields.has(fieldKey(key)));
      for (const key of boundedKeys) {
        const normalizedKey = fieldKey(key);
        if (nameContext && !privateFields.has(normalizedKey) && !genericIdentityFields.has(normalizedKey)) continue;
        if (nameContext || privateFields.has(normalizedKey) || (businessObject && genericIdentityFields.has(normalizedKey))) {
          const descriptor = nameFields.has(normalizedKey) ? Object.getOwnPropertyDescriptor(item, key) : undefined;
          result[truncate(key, 100)] = descriptor && "value" in descriptor ? normalize(descriptor.value, depth + 1, false, true) : REDACTED;
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        result[truncate(key, 100)] = descriptor && "value" in descriptor
          ? normalize(descriptor.value, depth + 1, identityContainers.has(normalizedKey)
            || (businessObject && descriptor.value !== null && typeof descriptor.value === "object"), personNameContainers.has(normalizedKey))
          : ACCESSOR_OMITTED;
      }
      if (keys.length > MAX_ITEMS) result["[truncated]"] = "Additional fields omitted";
      return result;
    } catch {
      return "[Unserializable value]";
    }
  };
  try {
    const normalized = normalize(value, 0);
    return truncate(typeof normalized === "string" ? normalized : JSON.stringify(normalized) ?? String(normalized), MAX_DIAGNOSTIC_LENGTH);
  } catch {
    return "[Unserializable value]";
  }
}

/** The backend applies final redaction and persistence. Never report logger failures recursively. */
export function logDiagnostic(logLevel: LogLevel, context: string, ...messages: unknown[]): void {
  try {
    const message = truncate(messages.slice(0, MAX_ITEMS).map(serializeDiagnostic).join(" "), MAX_DIAGNOSTIC_LENGTH);
    void invoke("console_log", { logLevel, context: truncate(context, 160), message }).catch(() => {
      // The IPC bridge may be unavailable during startup, shutdown or a browser preview.
    });
  } catch {
    // Logging must never replace the original error or prevent recovery.
  }
}

/** Compatibility entry point for existing callers in utils.tsx. */
export function consoleLog(logLevel: LogLevel, ...messages: unknown[]): void {
  logDiagnostic(logLevel, "frontend", ...messages);
}

export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    logDiagnostic(LOG_LEVEL_ERROR, "frontend.global.error", event.error ?? event.message, {
      line: event.lineno,
      column: event.colno,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    logDiagnostic(LOG_LEVEL_ERROR, "frontend.global.unhandledrejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
