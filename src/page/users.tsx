import { invoke } from "@tauri-apps/api/core";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  InputAdornment,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { useCurrentTermCourses } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { ExportUsersConfig, User } from "../lib/model";
import { formatDate } from "../lib/utils";

const surfaceCardSx = {
  borderRadius: "28px",
  border: "1px solid",
  borderColor: "divider",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
  backgroundImage: "none",
};

export default function UsersPage() {
  const theme = useTheme();
  const [messageApi, contextHolder] = useAppMessage();
  const [operating, setOperating] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
  const [exportConfig, setExportConfig] = useState<ExportUsersConfig>({
    save_name: "用户名单",
  } as ExportUsersConfig);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const courses = useCurrentTermCourses();

  const handleGetUsers = useCallback(async (courseId: number) => {
    if (courseId === -1) {
      return;
    }
    setOperating(true);
    try {
      const nextUsers = (await invoke("list_course_users", { courseId })) as User[];
      nextUsers.forEach((user) => {
        user.key = user.id;
      });
      setUsers(nextUsers);
    } catch (error) {
      messageApi.error(error as string);
    } finally {
      setOperating(false);
    }
  }, [messageApi]);

  const handleCourseSelect = useCallback(
    async (courseId: number) => {
      if (!courses.data.find((course) => course.id === courseId)) {
        return;
      }
      setSelectedCourseId(courseId);
      setSelectedUsers([]);
      setUsers([]);
      await handleGetUsers(courseId);
    },
    [courses.data, handleGetUsers]
  );

  const handleExport = useCallback(
    async (exportAll: boolean) => {
      if (!exportConfig.save_name?.trim()) {
        messageApi.error("请输入导出文件名");
        return;
      }
      const exportUsers = exportAll ? users : selectedUsers;
      if (exportUsers.length === 0) {
        messageApi.warning(exportAll ? "当前没有可导出的用户" : "请先选择要导出的用户");
        return;
      }

      try {
        await invoke("export_users", {
          users: exportUsers,
          saveName: `${exportConfig.save_name}.xlsx`,
        });
        messageApi.success(exportAll ? "导出全部成功" : "导出成功", 0.5);
      } catch (error) {
        messageApi.error(error as string);
      }
    },
    [exportConfig.save_name, messageApi, selectedUsers, users]
  );

  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map((user) => user.id)),
    [selectedUsers]
  );

  const paginatedUsers = useMemo(() => {
    const start = page * rowsPerPage;
    return users.slice(start, start + rowsPerPage);
  }, [page, rowsPerPage, users]);

  const selectedCourse = courses.data.find(
    (course) => course.id === selectedCourseId
  );

  useEffect(() => {
    setPage(0);
  }, [selectedCourseId, users.length]);

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={3}>
        <Card
          sx={{
            ...surfaceCardSx,
            background:
              theme.palette.mode === "dark"
                ? `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.18
                  )}, ${alpha("#0f172a", 0.9)})`
                : `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.1
                  )}, rgba(255,255,255,0.96))`,
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={3}>
              <Stack
                direction={{ xs: "column", lg: "row" }}
                justifyContent="space-between"
                spacing={2}
              >
                <Box>
                  <Typography variant="h4" sx={{ fontWeight: 800 }}>
                    人员导出
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    选择课程后即可查看成员信息，并导出全部或选中的人员名单。
                  </Typography>
                </Box>
                <Box
                  sx={{
                    width: "100%",
                    maxWidth: { xs: "100%", lg: 680 },
                    alignSelf: { xs: "stretch", lg: "flex-start" },
                  }}
                >
                  <CourseSelect
                    onChange={(courseId) => void handleCourseSelect(courseId)}
                    disabled={operating}
                    courses={courses.data}
                    value={selectedCourseId === -1 ? undefined : selectedCourseId}
                  />
                </Box>
              </Stack>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(4, minmax(0, 1fr))",
                  },
                }}
              >
                {[
                  { label: "总人数", value: users.length },
                  { label: "已选择", value: selectedUsers.length },
                  { label: "当前课程", value: selectedCourse ? 1 : 0 },
                  { label: "导出格式", value: "Excel" },
                ].map((item) => (
                  <Card
                    key={item.label}
                    sx={{
                      borderRadius: "22px",
                      backgroundColor: alpha(theme.palette.background.paper, 0.8),
                      border: "1px solid",
                      borderColor: alpha(theme.palette.divider, 0.5),
                      boxShadow: "none",
                    }}
                  >
                    <CardContent sx={{ p: 2.25 }}>
                      <Typography variant="overline" color="text.secondary">
                        {item.label}
                      </Typography>
                      <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>
                        {item.value}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>

              <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                {selectedCourse ? (
                  <Chip
                    icon={<GroupRoundedIcon />}
                    label={selectedCourse.name}
                    color="primary"
                    variant="outlined"
                  />
                ) : (
                  <Chip label="请选择课程" variant="outlined" />
                )}
                <Chip
                  label={`已选择 ${selectedUsers.length} / ${users.length}`}
                  variant="outlined"
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack spacing={3}>
              {users.length > 0 ? (
                <>
                  <Box
                    sx={{
                      borderRadius: "22px",
                      border: "1px solid",
                      borderColor: "divider",
                      overflow: "auto",
                    }}
                  >
                    <Table stickyHeader sx={{ minWidth: 980 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={users.length > 0 && selectedUsers.length === users.length}
                              indeterminate={
                                selectedUsers.length > 0 &&
                                selectedUsers.length < users.length
                              }
                              onChange={(event) =>
                                setSelectedUsers(event.target.checked ? users : [])
                              }
                            />
                          </TableCell>
                          <TableCell>ID</TableCell>
                          <TableCell>姓名</TableCell>
                          <TableCell>邮箱</TableCell>
                          <TableCell>加入时间</TableCell>
                          <TableCell>排序名</TableCell>
                          <TableCell>简称</TableCell>
                          <TableCell>学号 / 登录名</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {paginatedUsers.map((user) => {
                          const checked = selectedUserIds.has(user.id);
                          return (
                            <TableRow key={user.id} hover selected={checked}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={checked}
                                  onChange={(event) => {
                                    setSelectedUsers((prev) => {
                                      if (event.target.checked) {
                                        return [...prev, user];
                                      }
                                      return prev.filter((item) => item.id !== user.id);
                                    });
                                  }}
                                />
                              </TableCell>
                              <TableCell>{user.id}</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>{user.name}</TableCell>
                              <TableCell>{user.email || "-"}</TableCell>
                              <TableCell>{formatDate(user.created_at)}</TableCell>
                              <TableCell>{user.sortable_name || "-"}</TableCell>
                              <TableCell>{user.short_name || "-"}</TableCell>
                              <TableCell>{user.login_id || "-"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>

                  <TablePagination
                    component="div"
                    count={users.length}
                    page={page}
                    onPageChange={(_, nextPage) => setPage(nextPage)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={(event) => {
                      setRowsPerPage(Number(event.target.value));
                      setPage(0);
                    }}
                    rowsPerPageOptions={[10, 20, 50]}
                    labelRowsPerPage="每页人数"
                    labelDisplayedRows={({ from, to, count }) =>
                      `${from}-${to} / ${count}`
                    }
                  />

                  <Stack spacing={2}>
                    <TextField
                      label="导出文件名"
                      value={exportConfig.save_name}
                      onChange={(event) =>
                        setExportConfig((prev) => ({
                          ...prev,
                          save_name: event.target.value,
                        }))
                      }
                      helperText="导出时会保存为 .xlsx 文件。"
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">.xlsx</InputAdornment>
                        ),
                      }}
                    />
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                      <Button
                        variant="contained"
                        startIcon={<DownloadRoundedIcon />}
                        disabled={operating}
                        onClick={() => void handleExport(true)}
                      >
                        导出全部
                      </Button>
                      <Button
                        variant="outlined"
                        startIcon={<DownloadRoundedIcon />}
                        disabled={operating || selectedUsers.length === 0}
                        onClick={() => void handleExport(false)}
                      >
                        导出所选
                      </Button>
                    </Stack>
                  </Stack>
                </>
              ) : (
                <Alert severity="info" sx={{ borderRadius: "18px" }}>
                  选择课程后，这里会显示课程成员列表。
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </BasicLayout>
  );
}
