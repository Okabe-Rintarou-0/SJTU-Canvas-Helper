import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { consoleLog, installGlobalErrorHandlers, logDiagnostic, MAX_DIAGNOSTIC_LENGTH, serializeDiagnostic } from "./diagnostics";
import { LOG_LEVEL_ERROR } from "./model";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("diagnostic serialization", () => {
  it("redacts model aliases and Chinese identity fields regardless of scalar or structured values", () => {
    const fields = [
      "context_code", "author_id", "editor_id", "anonymous_id", "login_id", "login_user_id", "student_id", "student_ids", "sis_user_id", "email",
      "course_id", "course_code", "courseNo", "subjId", "courId",
      "teclCode", "teclId", "teachingClassId", "teacher_id", "library_id", "space_id", "学号", "教学班编号", "用户ID",
      "currentAccount", "allAccounts",
    ];
    for (const field of fields) {
      for (const value of ["私人值", 123456789, ["私人甲", "私人乙"], { nested: "私人丙" }]) {
        expect(JSON.parse(serializeDiagnostic({ [field]: value }))[field], field).toBe("[redacted]");
      }
    }
  });

  it("preserves only the first Unicode code point in all known name fields", () => {
    const fields = [
      "name", "title", "display_name", "sortableName", "short_name", "full_name", "realName", "nickname",
      "fileName", "output_name", "saveName", "externalTitle", "context_name", "assignmentName", "assignmetName",
      "userName", "author_name", "student_name", "student_names", "teacher_name", "teacher_names", "teacNames", "teacName", "tecName",
      "instructorName", "instructorNames", "courseName", "courseNames", "subject_name", "subjName", "courName", "tecl_name", "teaching-class-name",
      "videoName", "videName", "classroomName", "clroName", "organizationName", "ＣｏｕｒｓｅＮａｍｅ",
      "姓名", "名称", "标题", "显示名", "昵称", "用户名", "用户姓名", "学生姓名", "学生名字", "学生名单",
      "教师姓名", "教师名", "任课教师姓名", "老师姓名", "授课教师", "教师", "课程名", "课程名称", "教学班名称", "班级名称", "文件名", "文件名称",
    ];
    const examples = [
      ["大学英语", "大[redacted]"], ["College English", "C[redacted]"],
      ["𠮷课程", "𠮷[redacted]"], ["🎓Course", "🎓[redacted]"],
      [" \t\n　大学英语", "大[redacted]"], ["\"quoted course", "[redacted]"],
      ["\\escaped course", "[redacted]"], ["'quoted course", "[redacted]"],
      ["", "[redacted]"], [" \t\n　", "[redacted]"],
      ["\u0000course", "[redacted]"], ["\u007fcourse", "[redacted]"], ["\u0085course", "[redacted]"],
      ["\ud800course", "[redacted]"], ["\udfffcourse", "[redacted]"],
      ["[redacted]", "[redacted]"], ["[personal data omitted]", "[redacted]"],
      ["[Accessor omitted]", "[Accessor omitted]"], ["[Depth limit]", "[Depth limit]"],
      ["[Node limit]", "[Node limit]"], ["[Items truncated]", "[Items truncated]"], ["[Circular]", "[Circular]"],
    ];
    for (const field of fields) {
      for (const [value, expected] of examples) {
        const result = JSON.parse(serializeDiagnostic({ [field]: value, status: 400, request_id: "request-42" }));
        expect(result, `${field}: ${JSON.stringify(value)}`).toEqual({ [field]: expected, status: 400, request_id: "request-42" });
        expect(JSON.parse(serializeDiagnostic(result))).toEqual(result);
      }
      for (const value of [123456789, false, null]) {
        expect(JSON.parse(serializeDiagnostic({ [field]: value }))[field], field).toBe("[redacted]");
      }
    }
  });

  it("redacts each name in arrays and only known name values in name-bearing objects", () => {
    const input = {
      teacNames: ["张老师", " Alice Smith", 123, null, { display_name: "李老师", id: 123456, other: "秘密" }],
      studentNames: { name: "陈同学", student_id: 54321, login_id: "student@example.test", nested: { name: "不应暴露" } },
      teachers: ["王老师", { id: 654321, display_name: "Tom Smith", courseName: "物理课程", status: "private status" }],
      students: ["赵同学", { name: "黄同学", id: 987654 }],
      people: ["孙同学"],
      accounts: [{ name: "账号姓名", id: 456789 }],
      account: "secret-account-id",
      status: 400, request_id: "request-42",
    };
    const result = JSON.parse(serializeDiagnostic(input));
    expect(result).toEqual({
      teacNames: ["张[redacted]", "A[redacted]", "[redacted]", "[redacted]", { display_name: "李[redacted]", id: "[redacted]" }],
      studentNames: { name: "陈[redacted]", student_id: "[redacted]", login_id: "[redacted]" },
      teachers: ["王[redacted]", { id: "[redacted]", display_name: "T[redacted]", courseName: "物[redacted]" }],
      students: ["赵[redacted]", { name: "黄[redacted]", id: "[redacted]" }],
      people: ["孙[redacted]"],
      accounts: [{ name: "账[redacted]", id: "[redacted]" }],
      account: "[redacted]",
      status: 400, request_id: "request-42",
    });
    expect(JSON.parse(serializeDiagnostic(result))).toEqual(result);
  });

  it("omits unknown keys that can themselves contain names in name-bearing objects", () => {
    const input = {
      teachers: { 张三: { id: 1 }, 李四: { id: 2 }, display_name: "王老师", id: 3 },
      teacherNames: [{ 赵六: { id: 4 }, name: { 孙七: "秘密值", display_name: "吴老师", teacher_id: 5 } }],
      studentNames: { "Alice Smith": "private value" },
      status: 400, request_id: "request-42",
    };
    const serialized = serializeDiagnostic(input);
    expect(JSON.parse(serialized)).toEqual({
      teachers: { display_name: "王[redacted]", id: "[redacted]" },
      teacherNames: [{ name: { display_name: "吴[redacted]", teacher_id: "[redacted]" } }],
      studentNames: {},
      status: 400, request_id: "request-42",
    });
    for (const privateKey of ["张三", "李四", "赵六", "孙七", "Alice Smith"]) expect(serialized).not.toContain(privateKey);
  });

  it("redacts nested people/course identities while preserving diagnostic counters and request IDs", () => {
    const data = {
      operation: "ppt_list", step: "decode", status: 200, count: 3, code: "missing_field", request_id: "request-42",
      users: [{ id: 123, key: 123, name: "张三", status: "active", details: { email: "student@example.test" } }],
      courses: [{ id: 456, uuid: "course-uuid", courseName: "隐私课程", count: 2, request_id: "request-43" }],
      teachers: ["李老师", { id: 789, display_name: "王老师" }],
      network: { id: "network-request-1", request_id: "request-44", status: 401, line: 10, column: 3 },
    };
    expect(JSON.parse(serializeDiagnostic(data))).toEqual({
      operation: "ppt_list", step: "decode", status: 200, count: 3, code: "missing_field", request_id: "request-42",
      users: [{ id: "[redacted]", key: "[redacted]", name: "张[redacted]", status: "active", details: { email: "[redacted]" } }],
      courses: [{ id: "[redacted]", uuid: "[redacted]", courseName: "隐[redacted]", count: 2, request_id: "request-43" }],
      teachers: ["李[redacted]", { id: "[redacted]", display_name: "王[redacted]" }],
      network: { id: "network-request-1", request_id: "request-44", status: 401, line: 10, column: 3 },
    });
  });

  it("does not read sensitive getters, including fields inside arrays", () => {
    const getter = vi.fn(() => "private getter value");
    const student = Object.defineProperty({ status: "ready" }, "姓名", { enumerable: true, get: getter });
    const values: unknown[] = [];
    Object.defineProperty(values, "0", { enumerable: true, get: getter });
    const course = Object.defineProperty({ status: "ready" }, "courseName", { enumerable: true, get: getter });
    const teacher = Object.defineProperty({ id: 123 }, "display_name", { enumerable: true, get: getter });
    const output = serializeDiagnostic({ students: [student], courses: [course], teachers: [teacher], teacNames: values, unknown: values });
    expect(output).toContain('"姓名":"[redacted]"');
    expect(output).toContain('"courseName":"[redacted]"');
    expect(output).toContain('"display_name":"[redacted]"');
    expect(output).toContain("[Accessor omitted]");
    expect(getter).not.toHaveBeenCalled();
  });

  it("reserves standard error names for genuine Errors and removes private custom names from stacks", () => {
    const error = Object.assign(new Error("download failed"), { name: "张三老师", cause: new TypeError("invalid image") });
    error.stack = "张三老师: download failed\n    at loadImage (app.js:10:3)";
    const serialized = serializeDiagnostic(error);
    expect(serialized).not.toContain("张三老师");
    expect(JSON.parse(serialized)).toMatchObject({
      name: "Error", message: "download failed", stack: expect.stringContaining("app.js:10:3"),
      cause: { name: "TypeError", message: "invalid image" },
    });
    expect(JSON.parse(serializeDiagnostic({ name: "TypeError", message: "ordinary business data" })).name).toBe("T[redacted]");
  });

  it("preserves Error fields and nested causes that JSON.stringify drops", () => {
    const cause = new TypeError("连接失败");
    const error = Object.assign(new Error("下载失败"), { cause });
    expect(JSON.parse(serializeDiagnostic(error))).toMatchObject({
      name: "Error", message: "下载失败", stack: expect.stringContaining("下载失败"),
      cause: { name: "TypeError", message: "连接失败", stack: expect.stringContaining("连接失败") },
    });
  });

  it("keeps an upstream JSON response inside a bounded message string", () => {
    const response = JSON.stringify({ items: Array.from({ length: 10000 }, (_, index) => ({ index, body: "资料".repeat(20) })) });
    const serialized = JSON.parse(serializeDiagnostic(new Error(response)));
    expect(typeof serialized.message).toBe("string");
    expect(serialized.message.length).toBeLessThanOrEqual(4000);
    expect(serialized.message).toContain("[truncated]");
    expect(serialized).not.toHaveProperty("items");
  });

  it("bounds cyclic causes, deep and oversized data without invoking object getters", () => {
    const error = Object.assign(new Error("cycle"), { cause: undefined as unknown });
    error.cause = error;
    expect(serializeDiagnostic(error)).toContain("[Circular]");
    const data = { nested: {} as Record<string, unknown>, text: "中".repeat(100000) };
    let cursor = data.nested;
    for (let i = 0; i < 50; i++) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }
    const getter = vi.fn(() => { throw new Error("must not run"); });
    Object.defineProperty(data, "unsafe", { enumerable: true, get: getter });
    const serialized = serializeDiagnostic(data);
    expect(serialized).toContain("[Depth limit]");
    expect(serialized).toContain("[truncated]");
    expect(serialized).toContain("[Accessor omitted]");
    expect(serialized.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_LENGTH);
    expect(getter).not.toHaveBeenCalled();
    expect(serializeDiagnostic(new Proxy({}, { ownKeys: () => { throw new Error("proxy failed"); } }))).toBe("[Unserializable value]");
  });

  it("keeps depth, item and node limits when redacting nested names", () => {
    const cyclic: Record<string, unknown> = { display_name: "王老师" };
    cyclic.name = cyclic;
    expect(JSON.parse(serializeDiagnostic({ teacherNames: cyclic })).teacherNames).toEqual({ display_name: "王[redacted]", name: "[Circular]" });
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 10; index++) {
      const child: Record<string, unknown> = {};
      cursor.name = child;
      cursor = child;
    }
    cursor.display_name = "不应暴露";
    const depthLimited = serializeDiagnostic({ studentNames: deep });
    expect(depthLimited).toContain("[Depth limit]");
    expect(depthLimited).not.toContain("不应暴露");
    const itemLimited = JSON.parse(serializeDiagnostic({ teacherNames: Array.from({ length: 40 }, () => "王老师") }));
    expect(itemLimited.teacherNames).toHaveLength(31);
    expect(itemLimited.teacherNames.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => "王[redacted]"));
    expect(itemLimited.teacherNames[30]).toBe("[Items truncated]");
    const nodeLimited = serializeDiagnostic({ teachers: Array.from({ length: 30 }, () => ({ teacherNames: Array.from({ length: 30 }, () => "李老师") })) });
    expect(nodeLimited).toContain("[Node limit]");
    expect(nodeLimited).not.toContain("李老师");
    expect(nodeLimited.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_LENGTH);
  });
});

describe("frontend diagnostic delivery", () => {
  it("keeps the existing IPC contract and bounds a complete multi-value entry", () => {
    consoleLog(LOG_LEVEL_ERROR, new Error("broken"));
    expect(invoke).toHaveBeenCalledWith("console_log", {
      logLevel: LOG_LEVEL_ERROR, context: "frontend", message: expect.stringContaining('"message":"broken"'),
    });
    logDiagnostic(LOG_LEVEL_ERROR, "frontend.test", ...Array.from({ length: 100 }, () => "x".repeat(100000)));
    const entry = vi.mocked(invoke).mock.calls[1][1] as { message: string };
    expect(entry.message.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_LENGTH);
  });

  it("swallows rejected and synchronously unavailable bridges without recursive logging", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("bridge unavailable"));
    expect(() => consoleLog(LOG_LEVEL_ERROR, "original error")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(1);
    vi.mocked(invoke).mockImplementationOnce(() => { throw new Error("startup bridge missing"); });
    expect(() => consoleLog(LOG_LEVEL_ERROR, "second error")).not.toThrow();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("captures global errors and rejected promises and removes both listeners", () => {
    // Exercise browser event registration without broadcasting deliberate failures to Vitest's window.
    const target = new EventTarget() as unknown as Window;
    const remove = installGlobalErrorHandlers(target);
    const error = new ErrorEvent("error", { error: new Error("render outside React"), lineno: 12, colno: 3 });
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("unawaited command") });
    try {
      target.dispatchEvent(error);
      target.dispatchEvent(rejection);
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke).toHaveBeenNthCalledWith(1, "console_log", expect.objectContaining({ context: "frontend.global.error", message: expect.stringContaining("render outside React") }));
      expect(invoke).toHaveBeenNthCalledWith(2, "console_log", expect.objectContaining({ context: "frontend.global.unhandledrejection", message: expect.stringContaining("unawaited command") }));
    } finally {
      remove();
    }
    target.dispatchEvent(error);
    target.dispatchEvent(rejection);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
