import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { useCourses } from "../lib/hooks";
import { QRCodeScanResult } from "../lib/model";

export default function QRCodePage() {
  const theme = useTheme();
  const [operating, setOperating] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState<number | undefined>();
  const [scanResults, setScanResults] = useState<QRCodeScanResult[]>([]);
  const [keyword, setKeyword] = useState("");
  const [previewImage, setPreviewImage] = useState<QRCodeScanResult | null>(null);
  const courses = useCourses();

  const handleGetQRCode = async (courseId: number) => {
    setOperating(true);
    try {
      const nextScanResults = (await invoke("filter_course_qrcode_images", {
        courseId,
      })) as QRCodeScanResult[];
      setScanResults(nextScanResults);
    } catch (error) {
      console.error(error);
    }
    setOperating(false);
  };

  const handleCourseSelect = async (courseId: number) => {
    if (courses.data.find((course) => course.id === courseId)) {
      setSelectedCourseId(courseId);
      await handleGetQRCode(courseId);
    }
  };

  const selectedCourse = useMemo(
    () => courses.data.find((course) => course.id === selectedCourseId),
    [courses.data, selectedCourseId]
  );

  const filteredResults = useMemo(() => {
    if (!keyword.trim()) {
      return scanResults;
    }
    return scanResults.filter((item) =>
      item.file.display_name.toLowerCase().includes(keyword.trim().toLowerCase())
    );
  }, [keyword, scanResults]);

  return (
    <BasicLayout>
      <Stack spacing={3}>
        <Card
          sx={{
            borderRadius: "30px",
            border: "1px solid",
            borderColor: "divider",
            background:
              theme.palette.mode === "dark"
                ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, ${alpha(
                  theme.palette.background.paper,
                  0.94
                )})`
                : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(
                  "#ffffff",
                  0.94
                )})`,
            boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, md: 3.5 } }}>
            <Stack spacing={2.5}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Stack spacing={1}>
                  <Chip
                    icon={<QrCode2RoundedIcon />}
                    label="QR Gallery"
                    color="primary"
                    variant="outlined"
                    sx={{ width: "fit-content" }}
                  />
                  <Typography
                    variant="h4"
                    sx={{ fontWeight: 700, letterSpacing: "-0.03em" }}
                  >
                    二维码识别结果
                  </Typography>
                </Stack>

                <Stack spacing={1} alignItems={{ xs: "flex-start", md: "flex-end" }}>
                  <Chip
                    label={selectedCourse ? "已选择课程" : "等待选择课程"}
                    color={selectedCourse ? "success" : "default"}
                    variant={selectedCourse ? "filled" : "outlined"}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {selectedCourse ? selectedCourse.name : "请选择一个课程以读取二维码图片。"}
                  </Typography>
                </Stack>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: { xs: "minmax(0, 1fr)", xl: "1.15fr 0.85fr" },
                }}
              >
                <Box
                  sx={{
                    p: 2,
                    borderRadius: "22px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: alpha(theme.palette.background.paper, 0.78),
                  }}
                >
                  <CourseSelect
                    courses={courses.data}
                    disabled={operating}
                    onChange={handleCourseSelect}
                    value={selectedCourseId}
                  />
                </Box>

                <Box
                  sx={{
                    p: 2,
                    borderRadius: "22px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: alpha(theme.palette.background.paper, 0.78),
                  }}
                >
                  <TextField
                    fullWidth
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="按图片文件名搜索二维码…"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRoundedIcon color="action" />
                        </InputAdornment>
                      ),
                    }}
                  />
                </Box>
              </Box>

              {operating ? (
                <Box sx={{ py: 8, display: "grid", placeItems: "center" }}>
                  <Stack spacing={1.25} alignItems="center">
                    <CircularProgress />
                    <Typography variant="body2" color="text.secondary">
                      正在读取二维码图片，请稍候…
                    </Typography>
                  </Stack>
                </Box>
              ) : filteredResults.length > 0 ? (
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: {
                      xs: "minmax(0, 1fr)",
                      sm: "repeat(2, minmax(0, 1fr))",
                      xl: "repeat(3, minmax(0, 1fr))",
                    },
                  }}
                >
                  {filteredResults.map((scanResult) => (
                    <Card
                      key={scanResult.file.id}
                      onClick={() => setPreviewImage(scanResult)}
                      sx={{
                        borderRadius: "24px",
                        overflow: "hidden",
                        cursor: "pointer",
                        border: "1px solid",
                        borderColor: "divider",
                        transition: "transform 0.2s ease, box-shadow 0.2s ease",
                        "&:hover": {
                          transform: "translateY(-4px)",
                          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
                        },
                      }}
                    >
                      <Box
                        component="img"
                        src={scanResult.file.url}
                        alt={scanResult.file.display_name}
                        sx={{
                          width: "100%",
                          aspectRatio: "1 / 1",
                          objectFit: "cover",
                          display: "block",
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                        }}
                      />
                      <CardContent sx={{ p: 2 }}>
                        <Stack spacing={0.8}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {scanResult.file.display_name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            点击查看大图，更适合逐张核对。
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              ) : (
                <Alert severity="info" sx={{ borderRadius: "18px" }}>
                  {selectedCourse
                    ? "当前课程没有识别到二维码图片，或者搜索条件下没有匹配结果。"
                    : "请选择课程后开始读取二维码图片。"}
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={Boolean(previewImage)}
        onClose={() => setPreviewImage(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: "28px" } }}
      >
        <DialogTitle>{previewImage?.file.display_name}</DialogTitle>
        <DialogContent dividers>
          {previewImage ? (
            <Box
              component="img"
              src={previewImage.file.url}
              alt={previewImage.file.display_name}
              sx={{
                width: "100%",
                display: "block",
                borderRadius: "20px",
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </BasicLayout>
  );
}
