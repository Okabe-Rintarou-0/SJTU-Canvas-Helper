import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { Button, Stack, Typography } from "@mui/material";
import type { IDocument } from "@cyntler/react-doc-viewer";

export default function PreviewUnavailable({ document, fileName, failed }: {
  document: IDocument | undefined;
  fileName: string;
  failed?: boolean;
}) {
  const url = document?.uri;
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.25} sx={{ flex: 1, textAlign: "center", p: 3 }}>
      <InsertDriveFileOutlinedIcon color="action" fontSize="large" />
      <Typography variant="subtitle1" fontWeight={600}>
        {failed ? "文件预览失败" : "此格式暂不支持预览"}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>{fileName}</Typography>
      {url && /^(?:https?:|blob:)/i.test(url) && (
        <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="center">
          <Button component="a" href={url} download={fileName} variant="outlined" startIcon={<DownloadRoundedIcon />}>
            下载原文件
          </Button>
          {/^https?:/i.test(url) && (
            <Button component="a" href={url} target="_blank" rel="noreferrer" startIcon={<OpenInNewRoundedIcon />}>
              在浏览器打开
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}
