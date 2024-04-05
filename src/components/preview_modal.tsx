import DocViewer, { IDocument } from "@cyntler/react-doc-viewer";
import { Modal } from "antd";
import { File } from "../lib/model";
import { Md5 } from 'ts-md5';

// fix https://github.com/wojtekmaj/react-pdf/issues/991
import { pdfjs } from "react-pdf";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";
import { useEffect, useState } from "react";
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

export default function PreviewModal({ open, files, handleCancelPreview, title }: {
    open: boolean,
    files: File[],
    handleCancelPreview?: () => void,
    title?: string,
}) {
    const [docs, setDocs] = useState<IDocument[]>([]);

    useEffect(() => {
        initDocs();
    }, [files]);

    const initDocs = async () => {
        let docs = [];
        for (let file of files) {
            let uri = file.url;
            let fileName = file.display_name;
            let fileType = await getFileType(fileName);
            let doc = {
                uri,
                fileName,
                fileType,
            };
            docs.push(doc);
        }
        setDocs(docs);
    }

    // compute md5 as key
    const key = Md5.hashStr(files.map(file => file.url).reduce((k1, k2) => k1 + k2));
    return <Modal title={title} width={"90%"} styles={{ body: { height: "84vh", marginTop: "0px" } }} style={{ top: "10px" }}
        open={open} footer={null} onCancel={handleCancelPreview}>
        <DocViewer
            key={key}
            config={{
                header: {
                    disableFileName: true,
                    retainURLParams: true
                },
            }}
            pluginRenderers={BasicRenderers}
            documents={docs}
        />
    </Modal>
}