import { BMPRenderer, CSVRenderer, GIFRenderer, JPGRenderer, MSDocRenderer, PNGRenderer, TIFFRenderer, VideoRenderer } from "@cyntler/react-doc-viewer";
import ArchiveRenderer from "./archive_renderer";
import CodeRenderer from "./code_renderer";
import DocxRenderer from "./docx_renderer";
import ImageRenderer from "./img_renderer";
import JupiterNotebookRenderer from "./ipynb_renderer";
import MarkdownRenderer from "./markdown_renderer";
import MovRenderer from "./mov_renderer";
import PdfRenderer from "./pdf_renderer";
import XlsxRenderer from "./xlsx_renderer";

export const BasicRenderers = [BMPRenderer, JPGRenderer, PdfRenderer, PNGRenderer, TIFFRenderer, CSVRenderer, GIFRenderer, MovRenderer, VideoRenderer, MSDocRenderer,
    CodeRenderer, DocxRenderer, ImageRenderer, MarkdownRenderer, ArchiveRenderer, JupiterNotebookRenderer
]

// exclude MSDocRenderer
export const ArchiveSupportedRenderers = [BMPRenderer, JPGRenderer, PdfRenderer, PNGRenderer, TIFFRenderer, CSVRenderer, GIFRenderer, MovRenderer, VideoRenderer,
    XlsxRenderer, CodeRenderer, DocxRenderer, ImageRenderer, MarkdownRenderer, ArchiveRenderer, JupiterNotebookRenderer
]
