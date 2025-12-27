import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Space, Spin, Table, Tabs, TabsProps } from "antd";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { read, Sheet2JSONOpts, utils, WorkBook, WorkSheet } from 'xlsx';
import { getBase64Data } from "../lib/utils";

interface XlsxRow {
    [key: string]: any;
}

interface XlsxData {
    header: string[];
    rows: XlsxRow[];
}

const SHEET_TO_JSON_OPTS: Sheet2JSONOpts = {
    raw: false,
    defval: ''
};

export default function XlsxRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || !currentDocument.fileData) return null;

    const [currentData, setCurrentData] = useState<XlsxData | undefined>(undefined);
    const [workBook, setWorkBook] = useState<WorkBook | undefined>(undefined);
    const [currentSheet, setCurrentSheet] = useState<string>("");
    const [loading, setLoading] = useState<boolean>(true);
    const [messageApi, contextHolder] = useMessage();

    useEffect(() => {
        setLoading(true);
        setCurrentData(undefined);
        setWorkBook(undefined);
        setCurrentSheet("");

        try {
            const base64 = getBase64Data(currentDocument.fileData as string);
            const workbook = read(base64, { type: "base64" });

            setWorkBook(workbook);

            if (workbook.SheetNames.length > 0) {
                const initialSheet = workbook.SheetNames[0];
                handleSetSheet(workbook, initialSheet);
            }
        } catch (error) {
            messageApi.error(`Failed to parse Excel file: ${error instanceof Error ? error.message : String(error)}`);
            console.error("Excel parsing error:", error);
        } finally {
            setLoading(false);
        }
    }, [currentDocument, messageApi]);

    const extractHeader = (ws: WorkSheet): string[] => {
        const header: string[] = [];
        const ref = ws["!ref"];

        if (!ref) {
            return header;
        }

        const columnCount = utils.decode_range(ref).e.c + 1;

        for (let i = 0; i < columnCount; ++i) {
            const cellAddress = `${utils.encode_col(i)}1`;
            if (cellAddress in ws && ws[cellAddress]?.v !== undefined) {
                header.push(String(ws[cellAddress].v));
            } else {
                header.push(`Column ${i + 1}`);
            }
        }

        return header;
    };

    const handleSetSheet = (workbook: WorkBook, sheetName: string) => {
        const sheet = workbook.Sheets[sheetName];

        if (!sheet) {
            messageApi.error(`Sheet "${sheetName}" not found`);
            return;
        }

        try {
            const header = extractHeader(sheet);
            const rows = utils.sheet_to_json(sheet, SHEET_TO_JSON_OPTS) as XlsxRow[];

            setCurrentData({ header, rows });
            setCurrentSheet(sheetName);
        } catch (error) {
            messageApi.error(`Failed to process sheet "${sheetName}": ${error instanceof Error ? error.message : String(error)}`);
            console.error(`Sheet processing error for ${sheetName}:`, error);
        }
    };

    const tabs: TabsProps['items'] = workBook?.SheetNames.map(sheet => ({
        key: sheet,
        label: sheet
    })) || [];

    const handleChangeTab = (sheet: string) => {
        if (workBook) {
            handleSetSheet(workBook, sheet);
        }
    };

    const tableColumns = currentData?.header.map(header => ({
        key: header,
        title: header,
        dataIndex: header,
        ellipsis: true
    })) || [];

    return (
        <Space direction="vertical" style={{ width: '100%' }}>
            {contextHolder}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <Spin size="large" tip="Loading Excel file..." />
                </div>
            ) : (
                <>
                    {workBook && (
                        <Tabs
                            onChange={handleChangeTab}
                            items={tabs}
                            defaultActiveKey={currentSheet}
                            size="middle"
                        />
                    )}

                    {currentData ? (
                        <Table
                            columns={tableColumns}
                            dataSource={currentData.rows}
                            bordered
                            size="middle"
                            pagination={{
                                pageSize: 10,
                                showSizeChanger: true,
                                showQuickJumper: true,
                                showTotal: (total) => `Total ${total} records`
                            }}
                            scroll={{ x: true }}
                        />
                    ) : workBook?.SheetNames.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
                            No sheets found in the Excel file
                        </div>
                    ) : null}
                </>
            )}
        </Space>
    );
}

XlsxRenderer.fileTypes = ['xlsx', 'xls'];
XlsxRenderer.weight = 1;