import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import PreviewModal from "../components/preview_modal";
import { File } from "./model";
import PDFMerger from 'pdf-merger-js/browser';
import { Button, Progress, Space, message } from "antd";
import dayjs from "dayjs";
import { invoke } from "@tauri-apps/api";

export function usePreview() {
    const [previewFile, setPreviewFile] = useState<File | undefined>(undefined);
    const [hoveredFile, setHoveredFile] = useState<File | undefined>(undefined);
    const previewer = <Previewer previewFile={previewFile}
        setPreviewFile={setPreviewFile}
        hoveredFile={hoveredFile}
        setHoveredFile={setHoveredFile}
    />
    const onHoverFile = (file: File) => {
        if (!previewFile) {
            setHoveredFile(file);
        }
    }
    const onLeaveFile = () => {
        if (!previewFile) {
            setHoveredFile(undefined);
        }
    }
    return { previewer, onHoverFile, onLeaveFile, setPreviewFile }
}

type FileType = File | undefined;

function Previewer({ previewFile, setPreviewFile, hoveredFile, setHoveredFile }: {
    previewFile: FileType,
    setPreviewFile: Dispatch<SetStateAction<FileType>>,
    hoveredFile: FileType,
    setHoveredFile: Dispatch<SetStateAction<FileType>>
}) {
    const hoveredFileRef = useRef<File | undefined>(undefined);
    const previewFileRef = useRef<File | undefined>(undefined);

    useEffect(() => {
        document.body.addEventListener("keydown", handleKeyDownEvent, true);
        return () => {
            document.body.removeEventListener("keydown", handleKeyDownEvent, true);
        }
    }, []);

    useEffect(() => {
        previewFileRef.current = previewFile;
    }, [previewFile]);

    useEffect(() => {
        hoveredFileRef.current = hoveredFile;
    }, [hoveredFile]);

    const handleKeyDownEvent = (ev: KeyboardEvent) => {
        if (ev.key === " " && !ev.repeat) {
            ev.stopPropagation();
            ev.preventDefault();
            if (hoveredFileRef.current && !previewFileRef.current) {
                setHoveredFile(undefined);
                setPreviewFile(hoveredFileRef.current);
            } else if (previewFileRef.current) {
                setPreviewFile(undefined);
            }
        }
    }

    const handleCancelPreview = () => {
        setPreviewFile(undefined);
    }

    const shouldOpen = previewFile !== undefined;

    return <>
        {previewFile && <PreviewModal open={shouldOpen} files={[previewFile]} handleCancelPreview={handleCancelPreview} />}
    </>
}

export function useMerger({ setPreviewFile, onHoverFile, onLeaveFile }: {
    setPreviewFile: Dispatch<SetStateAction<FileType>>,
    onHoverFile: (file: File) => void,
    onLeaveFile: () => void,
}) {
    const [merging, setMerging] = useState<boolean>(false);
    const [pdfs, setPdfs] = useState<File[]>([]);
    const [currentStep, setCurrentStep] = useState<number>(0);
    const [error, setError] = useState<boolean>(false);
    const [msg, setMsg] = useState<string>("当前无任务");
    const [result, setResult] = useState<File | undefined>(undefined);
    const [resultBlob, setResultBlob] = useState<Blob | undefined>(undefined);

    const pdfMerger = new PDFMerger();

    const mergePDFs = async (pdfs: File[]) => {
        pdfs = pdfs.filter(pdf => pdf.mime_class.indexOf("pdf") !== -1);
        if (pdfs.length === 0) {
            message.warning("未选中多个可用的 PDF 文件🙅！");
            return;
        }
        if (pdfs.length === 1) {
            message.warning("单个 PDF 无需合并🤔️！");
            return;
        }
        if (merging) {
            message.warning("请等待当前合并任务执行完毕！");
            return;
        }
        setCurrentStep(0);
        setMerging(true);
        setPdfs(pdfs);
        for (let pdf of pdfs) {
            let pdfURL = pdf.url;
            try {
                setMsg(`正在添加 "${pdf.display_name}" ...`);
                await pdfMerger.add(pdfURL);
                setCurrentStep(currentStep => currentStep + 1);
            } catch (e) {
                setMsg(`合并 "${pdf.display_name}" 时出现错误🥹：${e}`);
                setError(true);
                return;
            }
        }

        setMsg("正在生成合并结果...");
        const mergedPdf = await pdfMerger.saveAsBlob();
        const url = URL.createObjectURL(mergedPdf);
        const result = { url, display_name: `merged_${dayjs().unix()}.pdf` } as File;
        setResult(result);
        setResultBlob(mergedPdf);
        setMsg("合并成功🎉！");
        setMerging(false);
    }

    const progress = <MergeProgress pdfs={pdfs} currentStep={currentStep} error={error} msg={msg} />

    const handleDownloadResult = async () => {
        if (!result || !resultBlob) {
            return;
        }
        let buffer = await resultBlob.arrayBuffer();
        let content = Array.from<number>(new Uint8Array(buffer));
        let fileName = result.display_name;
        try {
            await invoke("save_file_content", { content, fileName });
        } catch (e) {
            message.error(`下载失败😩：${e}`);
        }
    }

    const merger = <Space direction="vertical" style={{ width: "100%" }}>
        {progress}
        {result && <Space>
            <a onMouseEnter={() => onHoverFile(result)} onMouseLeave={onLeaveFile}>{result.display_name}</a>
            <Button onClick={() => setPreviewFile(result)}>预览</Button>
            <Button onClick={handleDownloadResult}>下载</Button>
        </Space>}
    </Space>

    return { merger, mergePDFs };
}

function MergeProgress({
    pdfs, currentStep, error, msg
}: {
    pdfs: File[],
    currentStep: number,
    error: boolean,
    msg: string,
}) {
    const totalSteps = pdfs.length;
    const percent = Math.ceil(currentStep / totalSteps * 100);
    const status = error ? "exception" : (percent !== 100 ? "active" : "success")
    return <Space direction="vertical" style={{ width: "100%" }}>
        {msg && <span>{msg}</span>}
        <Progress percent={percent} status={status} style={{ width: "100%" }} />
    </Space>
}