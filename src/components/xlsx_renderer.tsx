import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { read, WorkBook, WorkSheet, utils } from 'xlsx'
import { getBase64Data } from "../lib/utils";
import { Space, Tabs, TabsProps } from "antd";
import { useEffect, useState } from "react";
import xlsx from "../css/xlsx.module.css"
import useMessage from "antd/es/message/useMessage";

interface XlsxData {
    header: string[],
    rows: any[],
}

export default function XlsxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const [currentData, setCurrentData] = useState<XlsxData | undefined>(undefined);
    const [workBook, setWorkBook] = useState<WorkBook | undefined>(undefined);
    const [currentSheet, setCurrentSheet] = useState<string>("");
    const [messageApi, contextHolder] = useMessage();

    useEffect(() => {
        const base64 = getBase64Data(currentDocument.fileData as string);
        try {
            const workBook = read(base64, { type: "base64" });
            const sheets = workBook.SheetNames;
            setWorkBook(workBook);
            if (sheets.length > 0) {
                let currentSheet = workBook.SheetNames[0];
                handleSetSheet(workBook, currentSheet);
            }
        } catch (e) {
            messageApi.error(e as string);
        }
    }, []);

    const handleSetSheet = (workBook: WorkBook, currentSheet: string) => {
        let sheet = workBook.Sheets[currentSheet];
        if (!sheet) {
            return;
        }
        const header = extractHeader(sheet);
        const rows = utils.sheet_to_json(sheet);
        let data = { header, rows };
        setCurrentData(data);
        setCurrentSheet(currentSheet);
    }

    const extractHeader = (ws?: WorkSheet) => {
        const header = []
        const ref = ws?.["!ref"];
        if (!ref) {
            return [];
        }
        const columnCount = utils.decode_range(ref).e.c + 1
        for (let i = 0; i < columnCount; ++i) {
            header[i] = ws[`${utils.encode_col(i)}1`].v;
        }
        return header
    }

    const tabs: TabsProps['items'] = workBook?.SheetNames.map(sheet => ({
        key: sheet,
        label: sheet
    }));

    const handleChangeTab = (sheet: string) => {
        if (workBook) {
            handleSetSheet(workBook, sheet);
        }
    }

    return <Space direction="vertical">
        {contextHolder}
        {workBook && <Tabs onChange={handleChangeTab} items={tabs} defaultActiveKey={currentSheet}></Tabs>}
        {currentData &&
            <table className={xlsx.xlsx_table}>
                <thead><tr key={"header"}>{currentData.header.map(hdr => <th>{hdr}</th>)}</tr></thead>
                <tbody>
                    {currentData.rows.map((row, i) => (
                        <tr key={i}>
                            {currentData.header.map(hdr => <td>{row[hdr]}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        }
    </Space>
}

XlsxRenderer.fileTypes = ['xlsx'];
XlsxRenderer.weight = 1;