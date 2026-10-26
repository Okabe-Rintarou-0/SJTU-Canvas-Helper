import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCloudUploadTask } from "./upload_tasks";
import { TaskManager, taskKindLabels } from "./task_manager";
import type { AppConfig, File } from "./model";
import { getConfig } from "./config";
import { currentSession, invalidateSession } from "./session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./diagnostics", () => ({ logDiagnostic: vi.fn() }));
const file = { uuid: "file-id", display_name: "讲义.docx", filename: "lecture.docx" } as File;
const configFixture = (accessToken = "SYNTHETIC_JBOX_LOGIN", owner = `synthetic-upload-owner-${currentSession()}`): AppConfig => ({
  __config_owner: owner, token: "SYNTHETIC_CANVAS_TOKEN", account_type: "Default", save_path: "/synthetic-output",
  serve_as_plaintext: "", oauth_consumer_key: "", ja_auth_cookie: "", video_cookies: "",
  proxy_port: 7890, course_assignment_file_bindings: {}, show_alert_map: {},
  llm_api_key: "", llm_base_url: "", llm_model: "", llm_temperature: null,
  llm_api_keys: [], llm_active_api_key: "", theme: "light", compact_mode: false,
  color_primary: null, mcp_enabled: false, mcp_port: 3100, debug_mode: false,
  jbox_login_info: { library_id: "synthetic-library", space_id: "synthetic-space", access_token: accessToken },
});
let currentConfig: AppConfig;
async function publishFixture(config: AppConfig) {
  mocks.invoke.mockImplementation(async (command: string) => command === "get_config" ? config : undefined);
  currentConfig = await getConfig(true);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
}

describe("cloud upload tasks", () => {
  beforeEach(async () => {
    invalidateSession();
    await publishFixture(configFixture());
  });

  it("captures the destination and exposes uploads without pretending they are local downloads", async () => {
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "original", "课程 A/讲义", "课程 A");
    const queuedEventId = spec.event!.id;
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
    expect(spec).toMatchObject({ source: "files", kind: "upload", event: { channel: "file_upload://progress" } });
    expect(spec.event!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(spec.event!.id).not.toBe(file.uuid);
    expect(spec.event!.id).not.toBe(queuedEventId);
    expect(mocks.invoke).toHaveBeenCalledWith("upload_file", {
      file, saveDir: "课程 A/讲义", expectedOwner: currentConfig.__config_owner, operationId: spec.event!.id,
    });
    expect(manager.getSnapshot()[0]).toMatchObject({ canOpen: false, unreadCompletion: true });
  });

  it("does not re-authenticate or replay an upload whose outcome is uncertain", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("expired login"));
    const manager = new TaskManager();
    manager.enqueue(createCloudUploadTask(file, "original", "课程 A", "课程 A"));
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("failed"));
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["upload_file"]);
    expect(manager.getSnapshot()[0].error).toContain("避免重复上传");
    expect(manager.getSnapshot()[0].unreadCompletion).not.toBe(true);
  });

  it("retains failed uploads for explicit retry and does not flag them as completed", async () => {
    mocks.invoke.mockRejectedValue(new Error("network unavailable"));
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "original", "课程 A", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("failed"));
    const firstEventId = spec.event!.id;
    expect(manager.getSnapshot()[0].unreadCompletion).not.toBe(true);
    mocks.invoke.mockResolvedValue(undefined);
    manager.retry(spec.id);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
    expect(spec.event!.id).not.toBe(firstEventId);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["upload_file", "upload_file"]);
  });

  it("uses accurate PDF action labels and does not re-login for conversion errors", async () => {
    mocks.invoke.mockRejectedValue(new Error("Document conversion failed"));
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "pdf", "课程 A", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("failed"));
    expect(spec.kind).toBe("upload-pdf");
    expect(spec.name).toBe("讲义.pdf");
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["upload_file_as_pdf"]);
    expect(mocks.invoke).toHaveBeenCalledWith("upload_file_as_pdf", {
      file, saveDir: "课程 A", expectedOwner: currentConfig.__config_owner, operationId: spec.event!.id,
    });
    expect(taskKindLabels.conversion).toBe("转换为 PDF 并下载");
  });

  it("authenticates before the first upload and adopts only its returned owner", async () => {
    await publishFixture(configFixture("", "synthetic-empty-login-owner"));
    const previous = currentConfig;
    const next = configFixture("SYNTHETIC_NEW_LOGIN", "synthetic-login-successor");
    mocks.invoke.mockImplementation(async (command: string) => command === "login_jbox" ? next : undefined);
    const manager = new TaskManager();
    const spec = createCloudUploadTask(file, "original", "课程 A", "课程 A");
    manager.enqueue(spec);
    await vi.waitFor(() => expect(manager.getSnapshot()[0].status).toBe("succeeded"));
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["login_jbox", "upload_file"]);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "login_jbox", { expectedOwner: previous.__config_owner });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "upload_file", {
      file, saveDir: "课程 A", expectedOwner: next.__config_owner, operationId: spec.event!.id,
    });
  });
});
