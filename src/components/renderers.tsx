import { VideoRenderer } from "@cyntler/react-doc-viewer";
import ArchiveRenderer from "./archive_renderer";
import AudioRenderer from "./audio_renderer";
import CodeRenderer from "./code_renderer";
import CsvRenderer from "./csv_renderer";
import DocxRenderer from "./docx_renderer";
import ImageRenderer from "./img_renderer";
import JupiterNotebookRenderer from "./ipynb_renderer";
import MarkdownRenderer from "./markdown_renderer";
import MovRenderer from "./mov_renderer";
import PptxRenderer from "./pptx_renderer";
import PdfRenderer from "./pdf_renderer";
import XlsxRenderer from "./xlsx_renderer";

export const BasicRenderers = [PdfRenderer, PptxRenderer, CsvRenderer, MovRenderer, VideoRenderer,
    CodeRenderer, DocxRenderer, ImageRenderer, MarkdownRenderer, ArchiveRenderer, JupiterNotebookRenderer, XlsxRenderer,
    AudioRenderer,
]

export const ArchiveSupportedRenderers = [PdfRenderer, PptxRenderer, CsvRenderer, MovRenderer, VideoRenderer,
    XlsxRenderer, CodeRenderer, DocxRenderer, ImageRenderer, MarkdownRenderer, ArchiveRenderer, JupiterNotebookRenderer,
    AudioRenderer,
]
