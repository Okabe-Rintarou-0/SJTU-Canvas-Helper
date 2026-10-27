import { DocRendererProps } from "@cyntler/react-doc-viewer";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { read, utils } from "xlsx";

import { decodeBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

interface CsvRow {
  [key: string]: unknown;
}

export default function CsvRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  useEffect(() => {
    if (!currentDocument?.fileData) {
      return;
    }

    setLoading(true);
    setError(null);
    setHeaders([]);
    setRows([]);
    setPage(0);

    try {
      const text = decodeBase64Data(currentDocument.fileData as string);
      const workbook = read(text, { type: "string" });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;

      if (!firstSheet) {
        setError("未解析到有效的 CSV 内容。");
        return;
      }

      const jsonRows = utils.sheet_to_json<CsvRow>(firstSheet, {
        raw: false,
        defval: "",
      });
      const ref = firstSheet["!ref"];
      const nextHeaders: string[] = [];

      if (ref) {
        const columnCount = utils.decode_range(ref).e.c + 1;
        for (let index = 0; index < columnCount; index += 1) {
          const address = `${utils.encode_col(index)}1`;
          nextHeaders.push(String(firstSheet[address]?.v ?? `Column ${index + 1}`));
        }
      }

      setHeaders(nextHeaders);
      setRows(jsonRows);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [currentDocument]);

  const pagedRows = useMemo(() => {
    const start = page * rowsPerPage;
    return rows.slice(start, start + rowsPerPage);
  }, [page, rows, rowsPerPage]);

  return (
    <RendererShell
      title={currentDocument?.fileName ?? "CSV"}
      subtitle="CSV table preview"
      fileType={currentDocument?.fileType}
      icon={<TableChartRoundedIcon />}
      headerMode="compact"
      actions={
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" label={`${rows.length} 行`} variant="outlined" />
          <Chip size="small" label={`${headers.length} 列`} variant="outlined" />
        </Stack>
      }
      contentSx={{ p: 0, overflow: "hidden", minHeight: 420 }}
    >
      {loading ? (
        <Box sx={{ minHeight: 320, display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error" sx={{ m: 2, borderRadius: "18px" }}>
          CSV 解析失败：{error}
        </Alert>
      ) : headers.length === 0 ? (
        <Alert severity="info" sx={{ m: 2, borderRadius: "18px" }}>
          未读取到可展示的 CSV 数据。
        </Alert>
      ) : (
        <Stack sx={{ height: "100%" }}>
          <Box sx={{ flex: 1, minHeight: 0, px: 2, pt: 2 }}>
            <Box
              sx={{
                height: "100%",
                borderRadius: "20px",
                border: "1px solid",
                borderColor: "divider",
                overflow: "auto",
                bgcolor:
                  theme.palette.mode === "dark"
                    ? alpha("#020617", 0.42)
                    : alpha("#ffffff", 0.96),
                boxShadow:
                  theme.palette.mode === "dark"
                    ? "inset 0 1px 0 rgba(255,255,255,0.04)"
                    : "0 16px 36px rgba(15,23,42,0.06)",
              }}
            >
              <Table stickyHeader sx={{ minWidth: Math.max(720, headers.length * 160) }}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <TableCell
                        key={header}
                        sx={{
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                          bgcolor:
                            theme.palette.mode === "dark"
                              ? alpha("#0f172a", 0.94)
                              : alpha("#f8fafc", 0.98),
                        }}
                      >
                        {header}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagedRows.map((row, rowIndex) => (
                    <TableRow key={`csv-row-${rowIndex}`} hover>
                      {headers.map((header) => (
                        <TableCell
                          key={`csv-cell-${rowIndex}-${header}`}
                          sx={{
                            verticalAlign: "top",
                            color: "text.secondary",
                            maxWidth: 320,
                            wordBreak: "break-word",
                          }}
                        >
                          {String(row[header] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>

          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50, 100]}
            labelRowsPerPage="每页行数"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
            sx={{ px: 1.5 }}
          />
        </Stack>
      )}
    </RendererShell>
  );
}

CsvRenderer.fileTypes = ["csv"];
CsvRenderer.weight = 1;
