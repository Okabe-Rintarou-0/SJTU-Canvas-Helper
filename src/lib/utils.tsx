import { FileOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { MessageInstance } from "antd/es/message/interface";
import dayjs, { Dayjs } from "dayjs";
import { decode } from "js-base64";
import {
  FaFileCsv,
  FaImage,
  FaRegFileArchive,
  FaRegFileAudio,
  FaRegFilePdf,
  FaRegFileVideo,
} from "react-icons/fa";
import {
  PiMicrosoftExcelLogoFill,
  PiMicrosoftPowerpointLogoFill,
  PiMicrosoftWordLogoFill,
} from "react-icons/pi";
import { getConfig } from "./config";
import {
  Assignment,
  AssignmentDate,
  Attachment,
  File as FileModel,
  LOG_LEVEL_ERROR,
  LogLevel,
  ModuleItem,
  Option,
} from "./model";

export function isMergableFileType(fileType: string): boolean {
  for (let ext of ["pptx", "pdf", "docx"]) {
    if (fileType.toLowerCase().endsWith(ext)) {
      return true;
    }
  }
  return false;
}

export function formatDate(inputDate: Option<string>): string {
  if (!inputDate) {
    return "";
  }
  const date = new Date(inputDate);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

export function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export function base64ToBuffer(base64: string) {
  let binaryString = atob(base64);
  let length = binaryString.length;
  let bytes = new Uint8Array(length);

  for (let i = 0; i < length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

const aliasMap: Record<string, string> = {
  pptx: "ppt",
  cjs: "js",
  gitignore: "txt",
  mp4: "video/mp4",
};

export async function getFileType(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  let serveAsPlaintext = (await getConfig()).serve_as_plaintext.split(",");
  if (extension && aliasMap[extension]) {
    return aliasMap[extension];
  } else if (
    serveAsPlaintext.find((supportedExt) => supportedExt.trim() === extension)
  ) {
    // serve as txt
    return "txt";
  }
  return extension;
}

export function getBase64Data(raw: string) {
  if (raw.startsWith("data:") && raw.indexOf(",") !== -1) {
    return raw.split(",")[1];
  }
  return raw;
}

export function decodeBase64DataAsBinary(raw: string) {
  let base64 = getBase64Data(raw);
  let data;
  try {
    data = atob(base64);
  } catch (_) {
    data = raw;
  }
  return data;
}

export function decodeBase64Data(raw: string) {
  let base64 = getBase64Data(raw);
  let data;
  try {
    data = decode(base64);
  } catch (_) {
    data = raw;
  }
  return data;
}

export function dataURLtoFile(dataurl: string, filename: string) {
  var arr = dataurl.split(","),
    mime = arr[0].match(/:(.*?);/)?.[1],
    bstr = atob(arr[arr.length - 1]),
    n = bstr.length,
    u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
}

export function firstDayOfMonth(date: Dayjs) {
  return date.startOf("month").toISOString();
}

export function lastDayOfMonth(date: Dayjs) {
  return date.endOf("month").toISOString();
}

export function attachmentToFile(attachment: Attachment) {
  const prefix = attachment.user ? attachment.user + "_" : "";
  return {
    id: attachment.id,
    uuid: attachment.uuid,
    url: attachment.url,
    display_name: prefix + attachment.display_name,
    folder_id: attachment.folder_id ?? 0,
    locked: attachment.locked,
    filename: attachment.filename,
    size: attachment.size,
    mime_class: attachment.mime_class,
  } as FileModel;
}

export function getBaseDate(dates: AssignmentDate[]) {
  return dates.find((date) => date.base);
}

export function assignmentIsEnded(assignment: Assignment) {
  const baseDate = getBaseDate(assignment.all_dates);
  const dued = dayjs(baseDate?.due_at).isBefore(dayjs());
  const locked = dayjs(baseDate?.lock_at).isBefore(dayjs());
  return dued || locked;
}

export async function savePathValidator(_: any, savePath: string) {
  let valid = await invoke("check_path", { path: savePath });
  return valid
    ? Promise.resolve()
    : Promise.reject(new Error("保存路径无效！请检查目录是否存在！"));
}

export function assignmentIsNotUnlocked(assignment: Assignment) {
  const baseDate = getBaseDate(assignment.all_dates);
  if (!baseDate?.unlock_at) {
    return false;
  }
  const locked = dayjs(baseDate.unlock_at).isAfter(dayjs());
  return locked;
}

export function assignmentNotNeedSubmit(assignment: Assignment) {
  return (
    !assignment.submission ||
    assignment.submission_types.includes("none") ||
    assignment.submission_types.includes("not_graded")
  );
}

export function getFileIcon(file: FileModel) {
  const name = file.filename;
  const mime_class = file.mime_class;
  if (name.endsWith(".pdf")) {
    return <FaRegFilePdf style={{ fontSize: "22px" }} />;
  }
  if (name.endsWith(".doc") || name.endsWith(".docx")) {
    return <PiMicrosoftWordLogoFill style={{ fontSize: "24px" }} />;
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
    return <PiMicrosoftPowerpointLogoFill style={{ fontSize: "24px" }} />;
  }
  if (name.endsWith(".csv")) {
    return <FaFileCsv style={{ fontSize: "22px" }} />;
  }
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    return <PiMicrosoftExcelLogoFill style={{ fontSize: "24px" }} />;
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
    return <PiMicrosoftPowerpointLogoFill style={{ fontSize: "24px" }} />;
  }
  if (
    name.endsWith(".flv") ||
    name.endsWith(".mp4") ||
    name.endsWith(".mov") ||
    name.endsWith(".m4v") ||
    name.endsWith(".avi")
  ) {
    return <FaRegFileVideo style={{ fontSize: "22px" }} />;
  }
  if (name.endsWith(".mp3") || name.endsWith(".wav")) {
    return <FaRegFileAudio style={{ fontSize: "22px" }} />;
  }
  if (
    name.endsWith(".7z") ||
    name.endsWith(".rar") ||
    name.endsWith(".tar") ||
    name.endsWith(".zip")
  ) {
    return <FaRegFileArchive style={{ fontSize: "22px" }} />;
  }
  if (mime_class.startsWith("image")) {
    return <FaImage style={{ fontSize: "22px" }} />;
  }
  return <FileOutlined style={{ fontSize: "21px" }} />;
}

export function getBigFileIcon(file: FileModel) {
  const name = file.display_name;
  const mime_class = file.mime_class;
  if (name.endsWith(".pdf")) {
    return <FaRegFilePdf style={{ fontSize: "40px" }} />;
  }
  if (name.endsWith(".doc") || name.endsWith(".docx")) {
    return <PiMicrosoftWordLogoFill style={{ fontSize: "42px" }} />;
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
    return <PiMicrosoftPowerpointLogoFill style={{ fontSize: "42px" }} />;
  }
  if (name.endsWith(".csv")) {
    return <FaFileCsv style={{ fontSize: "40px" }} />;
  }
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    return <PiMicrosoftExcelLogoFill style={{ fontSize: "42px" }} />;
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
    return <PiMicrosoftPowerpointLogoFill style={{ fontSize: "42px" }} />;
  }
  if (
    name.endsWith(".flv") ||
    name.endsWith(".mp4") ||
    name.endsWith(".mov") ||
    name.endsWith(".m4v") ||
    name.endsWith(".avi")
  ) {
    return <FaRegFileVideo style={{ fontSize: "40px" }} />;
  }
  if (name.endsWith(".mp3") || name.endsWith(".wav")) {
    return <FaRegFileAudio style={{ fontSize: "40px" }} />;
  }
  if (
    name.endsWith(".7z") ||
    name.endsWith(".rar") ||
    name.endsWith(".tar") ||
    name.endsWith(".zip")
  ) {
    return <FaRegFileArchive style={{ fontSize: "40px" }} />;
  }
  if (mime_class.startsWith("image")) {
    return <FaImage style={{ fontSize: "40px" }} />;
  }
  return <FileOutlined style={{ fontSize: "39px" }} />;
}

export function scrollToTop() {
  window.scrollTo(0, 0);
}

export function scrollToEnd() {
  window.scrollTo(0, document.body.scrollHeight);
}

export async function checkForUpdates(messageApi: MessageInstance) {
  try {
    const messageKey = "checking";
    messageApi.open({
      key: messageKey,
      type: "loading",
      content: "检查中🚀...",
    });
    const update = await check();
    messageApi.destroy(messageKey);
    if (!update) {
      messageApi.warning("已经是最新版，无需更新😁");
    }
  } catch (error) {
    messageApi.error("🥹出现错误：" + error);
  }
}

export function consoleLog(logLevel: LogLevel, ...messages: any[]) {
  let message = messages
    .map((msg) => {
      if (typeof msg === "object") {
        return JSON.stringify(msg);
      } else {
        return String(msg);
      }
    })
    .join(" ");

  const context = new Error().stack?.split("\n")[1];
  invoke("console_log", { logLevel, context, message });
  console.log(message);
}

export function srtToVtt(srt: string) {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(
        /(\d+)\n(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/g,
        "$1\n$2.$3 --> $4.$5"
      )
      .replace(/\r/g, "")
  );
}

function detectExternalType(item: ModuleItem) {
  const supportedExt = [".pdf", ".doc", ".docx", ".pptx", ".txt", ".zip", ".7z", ".tar"];
  if (!item.external_url) return ["", undefined];
  let idx = item.external_url.lastIndexOf('/');
  let fileName = item.external_url.slice(idx + 1);
  idx = fileName.lastIndexOf('.');
  if (idx == -1) {
    return [fileName, "Link"];
  }
  const ext = fileName.slice(idx);
  consoleLog(LOG_LEVEL_ERROR, "ext", ext);
  if (supportedExt.indexOf(ext) !== -1) {
    return [fileName, "File"];
  }
  return [fileName, "Link"];
}

export function moduleItem2File(item: ModuleItem): FileModel {
  const [fileName, externalType] = detectExternalType(item);
  return {
    key: item.id.toString(),
    id: item.id,
    uuid: item.id.toString(),
    folder_id: 0,
    url: item.external_url,
    display_name: fileName,
    locked: false,
    filename: fileName,
    mime_class: "",
    "content-type": "",
    size: 0,
    external_type: externalType,
    external_title: item.title,
  } as FileModel;
}
