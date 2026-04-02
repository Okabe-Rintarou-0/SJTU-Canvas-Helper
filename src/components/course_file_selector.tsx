import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useState } from "react";

import { usePreview } from "../lib/hooks";
import { File } from "../lib/model";
import CourseFileSelectModal from "./course_file_select_modal";

interface CourseFileSelectorProps {
  courseId: number;
  initialFiles: File[];
  onSelectFiles?: (files: File[]) => void;
}

function CourseFileSelector({
  courseId,
  initialFiles,
  onSelectFiles,
}: CourseFileSelectorProps) {
  const theme = useTheme();
  const [showModal, setShowModal] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const { previewer, onHoverEntry, onLeaveEntry, setPreviewEntry } =
    usePreview();

  const handleSelect = (files: File[]) => {
    setSelectedFiles(files);
    setShowModal(false);
    onSelectFiles?.(files);
  };

  const handleRemoveFile = (fileToRemove: File) => {
    const updatedFiles = selectedFiles.filter((file) => file.id !== fileToRemove.id);
    setSelectedFiles(updatedFiles);
    onSelectFiles?.(updatedFiles);
  };

  useEffect(() => {
    setSelectedFiles(initialFiles);
  }, [initialFiles]);

  return (
    <>
      {previewer}
      <Card
        sx={{
          borderRadius: "22px",
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "none",
          backgroundImage: "none",
        }}
      >
        <CardContent sx={{ p: { xs: 2, md: 2.25 } }}>
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={1.5}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  选择课程文件
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  绑定评分参考资料、题面或答案文件，方便预览时快速对照。
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<FolderOpenRoundedIcon />}
                onClick={() => setShowModal(true)}
              >
                选择文件
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                icon={<AttachFileRoundedIcon />}
                label={`已绑定 ${selectedFiles.length} 个文件`}
                color="primary"
                variant="outlined"
              />
            </Stack>

            {selectedFiles.length > 0 ? (
              <Box
                sx={{
                  display: "grid",
                  gap: 1.5,
                  gridTemplateColumns: {
                    xs: "minmax(0, 1fr)",
                    md: "repeat(2, minmax(0, 1fr))",
                    xl: "repeat(3, minmax(0, 1fr))",
                  },
                }}
              >
                {selectedFiles.map((file) => (
                  <Card
                    key={file.id}
                    sx={{
                      borderRadius: "18px",
                      border: "1px solid",
                      borderColor: alpha(theme.palette.divider, 0.6),
                      boxShadow: "none",
                      backgroundColor: alpha(theme.palette.background.paper, 0.72),
                    }}
                  >
                    <CardContent sx={{ p: 1.75 }}>
                      <Stack spacing={1.25}>
                        <Stack direction="row" spacing={1.25} alignItems="flex-start">
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              borderRadius: "14px",
                              display: "grid",
                              placeItems: "center",
                              bgcolor: alpha(theme.palette.primary.main, 0.12),
                              color: "primary.main",
                              flexShrink: 0,
                            }}
                          >
                            <InsertDriveFileRoundedIcon />
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 700,
                                wordBreak: "break-word",
                              }}
                            >
                              {file.display_name}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            variant="text"
                            size="small"
                            onMouseEnter={() => onHoverEntry(file)}
                            onMouseLeave={onLeaveEntry}
                            onClick={() => setPreviewEntry(file)}
                          >
                            预览
                          </Button>
                          <Button
                            variant="text"
                            color="error"
                            size="small"
                            onClick={() => handleRemoveFile(file)}
                          >
                            移除
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            ) : (
              <Box
                sx={{
                  px: 2,
                  py: 4,
                  borderRadius: "18px",
                  border: "1px dashed",
                  borderColor: alpha(theme.palette.divider, 0.7),
                  textAlign: "center",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  暂未绑定课程文件。点击右上角“选择文件”开始添加。
                </Typography>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      <CourseFileSelectModal
        courseId={courseId}
        open={showModal}
        onCancel={() => setShowModal(false)}
        onOk={handleSelect}
      />
    </>
  );
}

export default CourseFileSelector;
