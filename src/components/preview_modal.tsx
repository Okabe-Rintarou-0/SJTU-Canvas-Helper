import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import { Modal } from "antd";
import { File } from "../lib/model";
import { Md5 } from 'ts-md5';

export default function PreviewModal({ open, files, handleCancelPreview }: {
    open: boolean,
    files: File[],
    handleCancelPreview?: () => void,
}) {
    const docs = files.map(file => {
        let mime = file.mime_class;
        let uri = file.url;
        let fileType = file.mime_class;
        switch (mime) {
            case "image":
                fileType = file["content-type"];
                break;
            default:
                break;
        }
        return {
            uri,
            fileType,
        }
    });

    // compute md5 as key
    const key = Md5.hashStr(files.map(file => file.url).reduce((k1, k2) => k1 + k2));

    return <Modal width={"80%"} styles={{ body: { height: "86vh" } }} style={{ top: "10px" }}
        open={open} footer={null} onCancel={handleCancelPreview}>
        <DocViewer
            key={key}
            config={{
                header: {
                    // disableHeader: true,
                    disableFileName: true,
                    retainURLParams: true
                }
            }}
            pluginRenderers={DocViewerRenderers}
            style={{ width: "100%", height: "100%" }}
            documents={docs}
        />
    </Modal>
}