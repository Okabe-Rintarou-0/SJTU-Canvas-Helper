import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import PreviewModal from "../components/preview_modal";
import { File } from "./model";

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