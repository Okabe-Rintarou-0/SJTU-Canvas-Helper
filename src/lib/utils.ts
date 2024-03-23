import { decode } from "js-base64";
import { getConfig } from "./store";
import { Dayjs } from "dayjs"
import { Attachment, File as FileModel } from "./model";

export function formatDate(inputDate: string): string {
    if (!inputDate) {
        return "";
    }
    const date = new Date(inputDate);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
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
    docx: "doc",
    pptx: "ppt",
    cjs: "js",
    gitignore: "txt",
    mp4: "video/mp4"
};

export async function getFileType(filename: string) {
    const extension = filename.split('.').pop()?.toLowerCase() ?? "";
    let serveAsPlaintext = (await getConfig()).serve_as_plaintext.split(',');
    if (extension && aliasMap[extension]) {
        return aliasMap[extension];
    } else if (serveAsPlaintext.find(supportedExt => supportedExt.trim() === extension)) {
        // serve as txt
        return "txt";
    }
    return extension;
}

export function getBase64Data(raw: string) {
    if (raw.startsWith("data:") && raw.indexOf(",") !== -1) {
        return raw.split(',')[1];
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
    var arr = dataurl.split(','),
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
    return date.startOf('month').toISOString();
}

export function lastDayOfMonth(date: Dayjs) {
    return date.endOf('month').toISOString();
}

export function attachmentToFile(attachment: Attachment) {
    const prefix = attachment.user ? attachment.user + "_" : "";
    return {
        id: attachment.id,
        uuid: attachment.uuid,
        url: attachment.url,
        display_name: prefix + attachment.display_name,
        folder_id: attachment.folder_id,
        locked: attachment.locked,
        filename: attachment.filename,
        size: attachment.size,
        mime_class: attachment.mime_class,
    } as FileModel;
}