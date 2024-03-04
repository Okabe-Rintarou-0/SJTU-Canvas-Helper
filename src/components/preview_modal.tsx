import DocViewer, { BMPRenderer, CSVRenderer, GIFRenderer, JPGRenderer, PDFRenderer, PNGRenderer, TIFFRenderer, VideoRenderer, MSDocRenderer } from "@cyntler/react-doc-viewer";
import { Modal } from "antd";
import { File } from "../lib/model";
import { Md5 } from 'ts-md5';

// fix https://github.com/wojtekmaj/react-pdf/issues/991
import { pdfjs } from "react-pdf";
import ZipRenderer from "./zip_renderer";
import CodeRenderer from "./code_renderer";
import DocxRenderer from "./docx_renderer";
import ImageRenderer from "./img_renderer";
import { getFileType } from "../lib/utils";
import MarkdownRenderer from "./markdown_renderer";
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.js`;

export const BasicRenderers = [BMPRenderer, JPGRenderer, PDFRenderer, PNGRenderer, TIFFRenderer, CSVRenderer, GIFRenderer, VideoRenderer, MSDocRenderer, CodeRenderer, DocxRenderer, ImageRenderer, MarkdownRenderer]

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
                }
            }}
            pluginRenderers={[...BasicRenderers, ZipRenderer]}
            documents={docs}
        />
    </Modal>
}