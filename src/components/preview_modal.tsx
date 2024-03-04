import DocViewer from "@cyntler/react-doc-viewer";
import { Modal } from "antd";
import { File } from "../lib/model";
import { Md5 } from 'ts-md5';

// fix https://github.com/wojtekmaj/react-pdf/issues/991
import { pdfjs } from "react-pdf";
import ZipRenderer from "./zip_renderer";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

export default function PreviewModal({ open, files, handleCancelPreview }: {
    open: boolean,
    files: File[],
    handleCancelPreview?: () => void,
}) {
    const docs = files.map(file => {
        let uri = file.url;
        let fileName = file.display_name;
        let fileType = getFileType(fileName);
        return {
            uri,
            fileName,
            fileType,
        }
    });

    // compute md5 as key
    const key = Md5.hashStr(files.map(file => file.url).reduce((k1, k2) => k1 + k2));
    return <Modal width={"90%"} styles={{ body: { height: "86vh" } }} style={{ top: "10px" }}
        open={open} footer={null} onCancel={handleCancelPreview}>
        <DocViewer
            key={key}
            config={{
                header: {
                    disableFileName: true,
                    retainURLParams: true
                },
            }}
            pluginRenderers={[...BasicRenderers, ZipRenderer]}
            documents={docs}
        />
    </Modal>
}