import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import PreviewModal from "../components/preview_modal";
import { Entry, File, isFile, LoginMessage } from "./model";
import PDFMerger from 'pdf-merger-js/browser';
import { Button, Input, Progress, Space, message } from "antd";
import dayjs from "dayjs";
import { invoke } from "@tauri-apps/api";
import { getConfig, saveConfig } from "./store";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { LoginAlertModal } from "../components/login_alert_modal";

const UPDATE_QRCODE_MESSAGE = "{ \"type\": \"UPDATE_QR_CODE\" }";
const SEND_INTERVAL = 1000 * 50;
const QRCODE_BASE_URL = "https://jaccount.sjtu.edu.cn/jaccount/confirmscancode";
const WEBSOCKET_BASE_URL = "wss://jaccount.sjtu.edu.cn/jaccount/sub";

export function usePreview() {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [previewEntry, setPreviewEntry] = useState<Entry | undefined>(undefined);
    const [hoveredEntry, setHoveredEntry] = useState<Entry | undefined>(undefined);

    const previewer = <Previewer previewEntry={previewEntry}
        setPreviewEntry={setPreviewEntry}
        hoveredEntry={hoveredEntry}
        setHoveredEntry={setHoveredEntry}
        entries={entries}
    />

    const onHoverEntry = (entry: Entry) => {
        if (!previewEntry) {
            setHoveredEntry(entry);
        }
    }
    const onLeaveEntry = () => {
        if (!previewEntry) {
            setHoveredEntry(undefined);
        }
    }
    return { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry, setEntries }
}

// type FileType = File | undefined;
type EntryType = Entry | undefined;

function Previewer({ previewEntry, setPreviewEntry, hoveredEntry, setHoveredEntry, entries }: {
    previewEntry: EntryType,
    setPreviewEntry: Dispatch<SetStateAction<EntryType>>,
    hoveredEntry: EntryType,
    setHoveredEntry: Dispatch<SetStateAction<EntryType>>
    entries: Entry[],
}) {
    const entriesRef = useRef<Entry[]>([]);
    const hoveredEntryRef = useRef<EntryType>(undefined);
    const previewEntryRef = useRef<EntryType>(undefined);

    const getNextEntry = (entry: Entry) => {
        const entries = entriesRef.current;
        const index = entries.findIndex(file => file.id === entry.id);
        if (index === -1) {
            return null;
        }
        if (index === entries.length - 1) {
            return entries[0];
        }
        return entries[index + 1];
    }

    const getPrevEntry = (entry: Entry) => {
        const entries = entriesRef.current;
        const index = entries.findIndex(file => file.id === entry.id);
        if (index === -1) {
            return null;
        }
        if (index === 0) {
            return entries[entries.length - 1];
        }
        return entries[index - 1];
    }

    useEffect(() => {
        document.body.addEventListener("keydown", handleKeyDownEvent, true);
        return () => {
            document.body.removeEventListener("keydown", handleKeyDownEvent, true);
        }
    }, []);

    useEffect(() => {
        previewEntryRef.current = previewEntry;
    }, [previewEntry]);

    useEffect(() => {
        hoveredEntryRef.current = hoveredEntry;
    }, [hoveredEntry]);

    useEffect(() => {
        entriesRef.current = entries;
    }, [entries]);

    const handleKeyDownEvent = (ev: KeyboardEvent) => {
        if (ev.key === " " && !ev.repeat) {
            ev.stopPropagation();
            ev.preventDefault();
            if (hoveredEntryRef.current && !previewEntryRef.current) {
                setHoveredEntry(undefined);
                setPreviewEntry(hoveredEntryRef.current);
            } else if (previewEntryRef.current) {
                setPreviewEntry(undefined);
            }
            return;
        }
        if (!previewEntryRef.current) {
            return;
        }

        if (ev.key === "ArrowRight" && !ev.repeat) {
            ev.stopPropagation();
            ev.preventDefault();
            const entry = getNextEntry(previewEntryRef.current);
            if (entry) {
                setHoveredEntry(undefined);
                setPreviewEntry(entry);
            }
        }
        if (ev.key === "ArrowLeft" && !ev.repeat) {
            ev.stopPropagation();
            ev.preventDefault();
            const entry = getPrevEntry(previewEntryRef.current);
            if (entry) {
                setHoveredEntry(undefined);
                setPreviewEntry(entry);
            }
        }
    }

    const handleCancelPreview = () => {
        setPreviewEntry(undefined);
    }

    const shouldOpen = previewEntry !== undefined;

    return <>{previewEntry &&
        isFile(previewEntry) &&
        <PreviewModal open={shouldOpen} files={[previewEntry as File]}
            title={(previewEntry as File).display_name}
            handleCancelPreview={handleCancelPreview} />
    }</>
}

export function useMerger({ setPreviewEntry, onHoverEntry, onLeaveEntry }: {
    setPreviewEntry: Dispatch<SetStateAction<EntryType>>,
    onHoverEntry: (entry: Entry) => void,
    onLeaveEntry: () => void,
}) {
    const [merging, setMerging] = useState<boolean>(false);
    const [downloading, setDownloading] = useState<boolean>(false);
    const [currentStep, setCurrentStep] = useState<number>(0);
    const [totalSteps, setTotalSteps] = useState<number>(0);
    const [error, setError] = useState<boolean>(false);
    const [msg, setMsg] = useState<string>("当前无任务");
    const [result, setResult] = useState<File | undefined>(undefined);
    const [resultBlob, setResultBlob] = useState<Blob | undefined>(undefined);
    const [outFileName, setOutFileName] = useState<string>("");
    const isSupportedType = (file: File) => {
        const name = file.display_name;
        return name.endsWith(".pdf") || name.endsWith(".pptx");
    }

    const mergePDFs = async (files: File[]) => {
        files = files.filter(file => isSupportedType(file));
        const pdfMerger = new PDFMerger();
        if (files.length === 0) {
            message.warning("未选中多个可用的 PDF 文件🙅！");
            return;
        }
        if (files.length === 1) {
            message.warning("单个 PDF 无需合并🤔️！");
            return;
        }
        if (merging) {
            message.warning("请等待当前合并任务执行完毕！");
            return;
        }
        if (downloading) {
            message.warning("请等待当前下载任务执行完毕！");
            return;
        }
        setTotalSteps(files.length);
        setCurrentStep(0);
        setMerging(true);
        for (let file of files) {
            try {
                setMsg(`正在添加 "${file.display_name}" ...`);
                if (file.display_name.endsWith(".pptx")) {
                    const data = new Uint8Array(await invoke("convert_pptx_to_pdf", { file }));
                    await pdfMerger.add(data);
                } else {
                    await pdfMerger.add(file.url);
                }
                setCurrentStep(currentStep => currentStep + 1);
            } catch (e) {
                setMsg(`合并 "${file.display_name}" 时出现错误🥹：${e}`);
                setError(true);
                setMerging(false);
                return;
            }
        }

        setMsg("正在生成合并结果...");
        const mergedPdf = await pdfMerger.saveAsBlob();
        const url = URL.createObjectURL(mergedPdf);
        const display_name = outFileName.length > 0 ? `${outFileName}.pdf` : `merged_${dayjs().unix()}.pdf`;
        const result = { url, display_name } as File;
        setResult(result);
        setResultBlob(mergedPdf);
        setMsg("合并成功🎉！");
        setMerging(false);
    }

    const progress = <MergeProgress totalSteps={totalSteps} currentStep={currentStep} error={error} msg={msg} />

    const handleDownloadResult = async () => {
        if (!result || !resultBlob) {
            return;
        }
        let buffer = await resultBlob.arrayBuffer();
        let content = Array.from<number>(new Uint8Array(buffer));
        let fileName = result.display_name;
        try {
            const chunkSize = 4 * 1024 * 1024;// 4MB
            const length = content.length;
            let chunkNumber = Math.round(length / chunkSize);
            if (length % chunkSize !== 0) {
                chunkNumber += 1;
            }
            setMsg("正在下载中...");
            setDownloading(true);
            setTotalSteps(chunkNumber);
            setCurrentStep(0);
            for (let i = 0; i < chunkNumber; i++) {
                let start = chunkSize * i;
                let end = start + chunkSize;
                const chunk = content.slice(start, end);
                await invoke("save_file_content", { content: chunk, fileName });
                setCurrentStep(i + 1);
            }
            setMsg("下载成功🎉！");
            setDownloading(false);
            message.success(`下载成功🎉！`);
        } catch (e) {
            message.error(`下载失败😩：${e}`);
        }
    }

    const merger = <Space direction="vertical" style={{ width: "100%" }}>
        <Space>自定义文件名：<Input onChange={(e) => setOutFileName(e.target.value)} placeholder="请输入自定义文件名" addonAfter={".pdf"} />
        </Space>
        {progress}
        {result && <Space>
            <a onMouseEnter={() => onHoverEntry(result)} onMouseLeave={onLeaveEntry}>{result.display_name}</a>
            <Button onClick={() => setPreviewEntry(result)}>预览</Button>
            <Button onClick={handleDownloadResult}>下载</Button>
        </Space>}
    </Space>

    return { merger, mergePDFs };
}

function MergeProgress({
    totalSteps, currentStep, error, msg
}: {
    totalSteps: number,
    currentStep: number,
    error: boolean,
    msg: string,
}) {
    const percent = Math.ceil(currentStep / totalSteps * 100);
    const status = error ? "exception" : (percent !== 100 ? "active" : "success")
    return <Space direction="vertical" style={{ width: "100%" }}>
        {msg && <span>{msg}</span>}
        <Progress percent={percent} status={status} style={{ width: "100%" }} />
    </Space>
}

export function useQRCode({ onScanSuccess }: {
    onScanSuccess?: () => void,
}) {
    const [uuid, setUuid] = useState<string>("");
    const [qrcode, setQrcode] = useState<string>("");
    const [wsURL, setWsURL] = useState<string>("");
    const { sendMessage, lastMessage, readyState } = useWebSocket(wsURL, undefined, wsURL.length > 0);

    const showQRCode = async () => {
        let uuid = await invoke("get_uuid") as string | null;
        if (uuid) {
            setUuid(uuid);
            setWsURL(`${WEBSOCKET_BASE_URL}/${uuid}`);
        }
    }

    const handleScanSuccess = async () => {
        try {
            let JAAuthCookie = await invoke("express_login", { uuid }) as string | null;
            if (!JAAuthCookie) {
                return;
            }
            console.log("读取到 JAAuthCookie: ", JAAuthCookie);
            let config = await getConfig();
            config.ja_auth_cookie = JAAuthCookie;
            await saveConfig(config);
            onScanSuccess?.();
        } catch (e) {
            message.error(`登录失败🥹：${e}`);
        }
    }

    useEffect(() => {
        if (readyState == ReadyState.OPEN) {
            sendMessage(UPDATE_QRCODE_MESSAGE);
            let handle = setInterval(() => {
                refreshQRCode();
            }, SEND_INTERVAL);
            return () => {
                clearInterval(handle);
            }
        }
    }, [readyState]);

    useEffect(() => {
        if (lastMessage) {
            try {
                let loginMessage = JSON.parse(lastMessage.data) as LoginMessage;
                switch (loginMessage.type.toUpperCase()) {
                    case "UPDATE_QR_CODE":
                        handleUpdateQrcode(loginMessage);
                        break;
                    case "LOGIN":
                        handleScanSuccess();
                        break;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }, [lastMessage]);

    const handleUpdateQrcode = (loginMessage: LoginMessage) => {
        let payload = loginMessage.payload;
        let qrcode = `${QRCODE_BASE_URL}?uuid=${uuid}&ts=${payload.ts}&sig=${payload.sig}`;
        setQrcode(qrcode);
    }

    const refreshQRCode = () => {
        sendMessage(UPDATE_QRCODE_MESSAGE);
    }

    return { qrcode, showQRCode, refreshQRCode }
}

export function useLoginModal({ onLogin }: { onLogin?: () => void }) {
    const [open, setOpen] = useState<boolean>(false);
    const showModal = () => setOpen(true);
    const closeModal = () => setOpen(false);
    let modal = <LoginAlertModal open={open} onCancelLogin={closeModal} onLogin={onLogin} />

    return { modal, showModal, closeModal }
}
