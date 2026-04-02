import { invoke } from "@tauri-apps/api/core";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import KeyboardBackspaceRoundedIcon from "@mui/icons-material/KeyboardBackspaceRounded";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import dayjs, { Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { useAppMessage } from "../lib/message";
import {
  Assignment,
  AssignmentDate,
  LOG_LEVEL_ERROR,
  User,
} from "../lib/model";
import { consoleLog } from "../lib/utils";

const ALL_USERS = [0];
const ALL_USERS_TARGET = ALL_USERS.join(",");

interface DDLFormData {
  target: string;
  dueAt: Dayjs | null;
  lockAt: Dayjs | null;
}

function toDateTimeLocal(value?: string | null) {
  if (!value) {
    return "";
  }
  return dayjs(value).format("YYYY-MM-DDTHH:mm");
}

function fromDateTimeLocal(value: string) {
  if (!value) {
    return null;
  }
  return dayjs(value);
}

export default function ModifyDDLModal({
  open,
  assignment,
  courseId,
  handleCancel,
  onSuccess,
  onRefresh,
}: {
  open: boolean;
  courseId: number;
  assignment: Assignment;
  handleCancel?: () => void;
  onRefresh?: () => void;
  onSuccess?: () => void;
}) {
  const [messageApi, contextHolder] = useAppMessage();
  const [mode, setMode] = useState<"modify" | "add">("modify");
  const [users, setUsers] = useState<User[]>([]);
  const [overrideUserIds, setOverrideUserIds] = useState<number[][]>([
    ALL_USERS,
  ]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<DDLFormData>({
    target: ALL_USERS_TARGET,
    dueAt: null,
    lockAt: null,
  });

  const getTargetDate = (target: string) => {
    if (target === ALL_USERS_TARGET) {
      return assignment.all_dates.find((date) => date.base);
    }
    const overrideId = assignment.overrides.find(
      (override) => override.student_ids.join(",") === target
    )?.id;
    return assignment.all_dates.find((date) => date.id === overrideId);
  };

  const [targetDate, setTargetDate] = useState<AssignmentDate | undefined>();

  const userMap = useMemo(() => {
    const map = new Map<number, User>();
    users.forEach((user) => map.set(user.id, user));
    return map;
  }, [users]);

  useEffect(() => {
    const handleInitUsers = async () => {
      try {
        const nextUsers = (await invoke("list_course_students", {
          courseId,
        })) as User[];
        setUsers(nextUsers);
      } catch (error) {
        consoleLog(LOG_LEVEL_ERROR, error);
      }
    };
    void handleInitUsers();
  }, [courseId]);

  useEffect(() => {
    if (!targetDate) {
      return;
    }
    setFormData((prev) => ({
      ...prev,
      dueAt: targetDate.due_at ? dayjs(targetDate.due_at) : null,
      lockAt: targetDate.lock_at ? dayjs(targetDate.lock_at) : null,
    }));
  }, [targetDate]);

  const init = () => {
    setFormData({
      target: ALL_USERS_TARGET,
      dueAt: null,
      lockAt: null,
    });
    setTargetDate(getTargetDate(ALL_USERS_TARGET));
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    init();
    setMode("modify");
    setNeedRefresh(false);
    setOverrideUserIds([
      ALL_USERS,
      ...assignment.overrides.map((override) => override.student_ids),
    ]);
  }, [assignment, open]);

  useEffect(() => {
    const existedUsers = new Set<number>();
    overrideUserIds.forEach((ids) => ids.forEach((id) => existedUsers.add(id)));
    setAvailableUsers(users.filter((user) => !existedUsers.has(user.id)));
  }, [overrideUserIds, users]);

  const handleModifyAssignmentDDL = async (dueAt?: string, lockAt?: string) => {
    await invoke("modify_assignment_ddl", {
      dueAt,
      lockAt,
      courseId,
      assignmentId: assignment.id,
    });
  };

  const handleModifyAssignmentDDLOverride = async (
    dueAt?: string,
    lockAt?: string
  ) => {
    const overrideId = targetDate?.id;
    if (!overrideId) {
      return;
    }
    await invoke("modify_assignment_ddl_override", {
      dueAt,
      lockAt,
      overrideId,
      courseId,
      assignmentId: assignment.id,
    });
  };

  const handleAddAssignmentDDLOverride = async (
    studentId: number,
    studentName: string,
    dueAt?: string,
    lockAt?: string
  ) => {
    await invoke("add_assignment_ddl_override", {
      dueAt,
      lockAt,
      studentId,
      courseId,
      title: studentName,
      assignmentId: assignment.id,
    });
  };

  const handleDeleteAssignmentDDLOverride = async (overrideId: number) => {
    try {
      await invoke("delete_assignment_ddl_override", {
        courseId,
        assignmentId: assignment.id,
        overrideId,
      });
      messageApi.success("删除成功", 0.5);
      const overrideToDelete = assignment.overrides.find(
        (override) => override.id === overrideId
      );
      if (overrideToDelete) {
        const targetToDelete = overrideToDelete.student_ids.join(",");
        setOverrideUserIds((ids) =>
          ids.filter((currentIds) => currentIds.join(",") !== targetToDelete)
        );
      }
      init();
      setNeedRefresh(true);
    } catch (error) {
      messageApi.error(`删除失败：${error}`);
    }
  };

  const handleSubmit = async () => {
    const { dueAt, lockAt, target } = formData;
    if (!target) {
      messageApi.warning("请选择一个目标");
      return;
    }

    const newDueAt = dueAt?.toISOString();
    const newLockAt = lockAt?.toISOString();
    const modifyAll = target === ALL_USERS_TARGET;

    try {
      setSubmitting(true);
      if (mode === "modify") {
        if (modifyAll) {
          await handleModifyAssignmentDDL(newDueAt, newLockAt);
        } else {
          await handleModifyAssignmentDDLOverride(newDueAt, newLockAt);
        }
        messageApi.success("修改成功", 0.5);
      } else {
        const studentId = Number.parseInt(target, 10);
        const studentName = userMap.get(studentId)?.name ?? "学生";
        await handleAddAssignmentDDLOverride(
          studentId,
          studentName,
          newDueAt,
          newLockAt
        );
        messageApi.success("添加成功", 0.5);
      }
      onSuccess?.();
    } catch (error) {
      messageApi.error(`修改失败：${error}`);
    } finally {
      setSubmitting(false);
    }
  };

  const targetOptions = overrideUserIds.map((ids) => ({
    value: ids.join(","),
    ids,
  }));

  const handleCancelModal = () => {
    handleCancel?.();
    if (needRefresh) {
      onRefresh?.();
      setNeedRefresh(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleCancelModal} fullWidth maxWidth="md">
      {contextHolder}
      <DialogTitle sx={{ pb: 1 }}>
        <Stack spacing={0.75}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            修改作业日期
          </Typography>
          <Typography variant="body2" color="text.secondary">
            为整个班级或指定学生设置新的截止时间与结束时间。
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Stack spacing={3}>
          <Alert severity="info" sx={{ borderRadius: "18px" }}>
            当前作业：{assignment.name}
          </Alert>

          {mode === "modify" ? (
            <Stack spacing={2}>
              <TextField
                select
                label="目标"
                value={formData.target}
                onChange={(event) => {
                  const target = event.target.value;
                  setFormData((prev) => ({ ...prev, target }));
                  setTargetDate(getTargetDate(target));
                }}
              >
                {targetOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    <Stack
                      direction="row"
                      spacing={0.75}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      {option.ids.map((id) => (
                        <Chip
                          key={id}
                          size="small"
                          label={
                            id === 0
                              ? overrideUserIds.length > 1
                                ? "其他所有人"
                                : "所有人"
                              : userMap.get(id)?.name || `用户 ${id}`
                          }
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>

              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Button
                  variant="outlined"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => {
                    setMode("add");
                    setFormData((prev) => ({ ...prev, target: "" }));
                  }}
                >
                  添加目标
                </Button>
                <Button
                  color="error"
                  variant="outlined"
                  disabled={targetDate?.base !== false}
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() =>
                    targetDate?.id
                      ? void handleDeleteAssignmentDDLOverride(targetDate.id)
                      : undefined
                  }
                >
                  删除当前目标
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Autocomplete
                options={availableUsers}
                getOptionLabel={(option) =>
                  `${option.name}${option.login_id ? ` · ${option.login_id}` : ""}`
                }
                value={
                  availableUsers.find(
                    (user) => user.id === Number(formData.target || -1)
                  ) ?? null
                }
                onChange={(_, nextValue) =>
                  setFormData((prev) => ({
                    ...prev,
                    target: nextValue ? String(nextValue.id) : "",
                  }))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="添加学生目标"
                    placeholder="输入姓名或学号搜索"
                  />
                )}
              />
              <Button
                variant="text"
                startIcon={<KeyboardBackspaceRoundedIcon />}
                onClick={() => {
                  setMode("modify");
                  init();
                }}
                sx={{ alignSelf: "flex-start" }}
              >
                返回修改已有目标
              </Button>
            </Stack>
          )}

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "minmax(0, 1fr)",
                md: "repeat(2, minmax(0, 1fr))",
              },
            }}
          >
            <TextField
              label="截止时间"
              type="datetime-local"
              value={toDateTimeLocal(formData.dueAt?.toISOString())}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  dueAt: fromDateTimeLocal(event.target.value),
                }))
              }
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="结束时间"
              type="datetime-local"
              value={toDateTimeLocal(formData.lockAt?.toISOString())}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  lockAt: fromDateTimeLocal(event.target.value),
                }))
              }
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={handleCancelModal}>取消</Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={submitting}>
          保存修改
        </Button>
      </DialogActions>
    </Dialog>
  );
}
