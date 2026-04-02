import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import {
  Alert,
  Box,
  CircularProgress,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { read, Sheet2JSONOpts, utils, WorkBook, WorkSheet } from "xlsx";

import { useAppMessage } from "../lib/message";
import { getBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

interface XlsxRow {
  [key: string]: any;
}

interface XlsxData {
  header: string[];
  rows: XlsxRow[];
}

const SHEET_TO_JSON_OPTS: Sheet2JSONOpts = {
  raw: false,
  defval: "",
};

export default function XlsxRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  if (!currentDocument || !currentDocument.fileData) {
    return null;
  }

  const [currentData, setCurrentData] = useState<XlsxData | undefined>();
  const [workBook, setWorkBook] = useState<WorkBook | undefined>();
  const [currentSheet, setCurrentSheet] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [messageApi, contextHolder] = useAppMessage();

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
      messageApi.error(
        `Failed to parse Excel file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setLoading(false);
    }
  }, [currentDocument, messageApi]);

  useEffect(() => {
    setPage(0);
  }, [currentSheet, currentData?.rows.length]);

  const extractHeader = (ws: WorkSheet): string[] => {
    const header: string[] = [];
    const ref = ws["!ref"];
    if (!ref) {
      return header;
    }

    const columnCount = utils.decode_range(ref).e.c + 1;
    for (let i = 0; i < columnCount; i += 1) {
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
      messageApi.error(
        `Failed to process sheet "${sheetName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const paginatedRows = useMemo(() => {
    if (!currentData) {
      return [];
    }
    const start = page * rowsPerPage;
    return currentData.rows.slice(start, start + rowsPerPage);
  }, [currentData, page, rowsPerPage]);

  return (
    <RendererShell
      title={currentDocument.fileName ?? "Spreadsheet"}
      subtitle="Excel workbook"
      fileType={currentDocument.fileType}
      icon={<TableChartRoundedIcon />}
      actions={
        currentSheet ? (
          <Typography variant="caption" color="text.secondary">
            当前工作表：{currentSheet}
          </Typography>
        ) : undefined
      }
      contentSx={{ p: 0 }}
    >
      {contextHolder}
      {loading ? (
        <Box sx={{ minHeight: 320, display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Box>
      ) : workBook?.SheetNames.length ? (
        <Box sx={{ height: "100%" }}>
          <Tabs
            value={currentSheet}
            onChange={(_, value) => workBook && handleSetSheet(workBook, value)}
            sx={{ px: 2, pt: 1 }}
            variant="scrollable"
            scrollButtons="auto"
          >
            {workBook.SheetNames.map((sheet) => (
              <Tab key={sheet} value={sheet} label={sheet} />
            ))}
          </Tabs>

          {currentData ? (
            <Box sx={{ px: 2, pb: 2 }}>
              <Box
                sx={{
                  borderRadius: "18px",
                  border: "1px solid",
                  borderColor: "divider",
                  overflow: "auto",
                }}
              >
                <Table stickyHeader sx={{ minWidth: 720 }}>
                  <TableHead>
                    <TableRow>
                      {currentData.header.map((header) => (
                        <TableCell key={header}>{header}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedRows.map((row, rowIndex) => (
                      <TableRow key={`${currentSheet}-${rowIndex}`} hover>
                        {currentData.header.map((header) => (
                          <TableCell key={`${rowIndex}-${header}`}>
                            {String(row[header] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              <TablePagination
                component="div"
                count={currentData.rows.length}
                page={page}
                onPageChange={(_, nextPage) => setPage(nextPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(Number(event.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 20, 50]}
                labelRowsPerPage="每页行数"
                labelDisplayedRows={({ from, to, count }) =>
                  `${from}-${to} / ${count}`
                }
              />
            </Box>
          ) : null}
        </Box>
      ) : (
        <Alert severity="info" sx={{ m: 2, borderRadius: "18px" }}>
          No sheets found in the Excel file
        </Alert>
      )}
    </RendererShell>
  );
}

XlsxRenderer.fileTypes = ["xlsx", "xls"];
XlsxRenderer.weight = 1;
