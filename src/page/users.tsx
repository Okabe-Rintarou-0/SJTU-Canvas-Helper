import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import { downloadCourseContext } from "../lib/downloads";
import { invoke } from "@tauri-apps/api/core";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  IconButton,
  MenuItem,
  MenuList,
  Popover,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  InputAdornment,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";

import CourseSelect from "../components/course_select";
import { WorkspaceHero } from "../components/workspace_hero";
import BasicLayout from "../components/layout";
import { TableSkeleton } from "../components/skeleton";
import { useCurrentTermCourses, useSelectedCourse } from "../lib/hooks";
import { useAppMessage } from "../lib/message";
import { CourseMember, ExportUsersConfig, User } from "../lib/model";
import { formatDate } from "../lib/utils";

import { surfaceCardSx } from "../lib/styles";

const roleNames = new Map([
  ["StudentEnrollment", "学生"],
  ["TaEnrollment", "助教"],
  ["TeacherEnrollment", "教师"],
  ["ObserverEnrollment", "观察员"],
  ["DesignerEnrollment", "课程设计者"],
  ["StudentViewEnrollment", "测试学生"],
]);

const columns = [
  { key: "id", label: "ID", kind: "text", sortable: true },
  { key: "name", label: "姓名", kind: "text", sortable: true },
  { key: "role", label: "身份", kind: "role", sortable: true },
  { key: "email", label: "邮箱", kind: "text" },
  { key: "joined", label: "加入课程时间", kind: "date", sortable: true },
  { key: "accountCreated", label: "账号创建时间", kind: "date", sortable: true },
  { key: "sortableName", label: "排序名", kind: "text", sortable: true },
  { key: "shortName", label: "简称", kind: "text" },
  { key: "login", label: "学号 / 登录名", kind: "text", sortable: true },
] as const;

type MemberColumn = (typeof columns)[number];
type SortColumn = Extract<MemberColumn, { sortable: true }>["key"];
const memberCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function memberRow(user: CourseMember) {
  const roles = new Set<string>();
  const labels = new Set<string>();
  let joined: string | undefined;
  let earliest = Infinity;
  for (const enrollment of user.enrollments ?? []) {
    const role = enrollment.type || enrollment.role;
    const label = enrollment.role || role;
    if (role) roles.add(role);
    if (label) labels.add(roleNames.get(label) ?? label);
    const createdAt = Date.parse(enrollment.created_at ?? "");
    if (createdAt < earliest) {
      earliest = createdAt;
      joined = enrollment.created_at ?? undefined;
    }
  }
  return {
    user,
    roles,
    joinedTimestamp: Number.isFinite(earliest) ? earliest : null,
    accountTimestamp: user.created_at ? Date.parse(user.created_at) : null,
    cells: {
      id: String(user.id),
      name: user.name,
      role: [...labels].join("、"),
      email: user.email ?? "",
      joined: formatDate(joined),
      accountCreated: formatDate(user.created_at),
      sortableName: user.sortable_name,
      shortName: user.short_name,
      login: user.login_id,
    },
  };
}

function memberSortValue(row: ReturnType<typeof memberRow>, key: SortColumn) {
  switch (key) {
    case "id": return row.user.id;
    case "joined": return row.joinedTimestamp;
    case "accountCreated": return row.accountTimestamp;
    default: return row.cells[key];
  }
}

export default function UsersPage() {
  const [messageApi, contextHolder] = useAppMessage();
  const [operating, setOperating] = useState(false);
  const [users, setUsers] = useState<CourseMember[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [filters, setFilters] = useState<Partial<Record<MemberColumn["key"], string>>>({ role: "StudentEnrollment" });
  const [sort, setSort] = useState<{ key: SortColumn; direction: "asc" | "desc" } | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ column: MemberColumn; anchor: HTMLElement } | null>(null);
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const [exportConfig, setExportConfig] = useState<ExportUsersConfig>({
    save_name: "用户名单",
  } as ExportUsersConfig);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const courses = useCurrentTermCourses();
  const selectedCourse = courses.data.find((course) => course.id === selectedCourseId);
  const courseId = selectedCourse?.id;

  useEffect(() => {
    if (courseId === undefined) return;
    let active = true;
    setOperating(true);
    setUsers([]);
    setSelectedUserIds(new Set());
    setPage(0);
    void invoke<CourseMember[]>("list_course_members", { courseId })
      .then((members) => { if (active) setUsers(members); })
      .catch((error) => { if (active) messageApi.error(error as string); })
      .finally(() => { if (active) setOperating(false); });
    return () => { active = false; };
  }, [courseId, messageApi]);

  const rows = useMemo(() => users.map(memberRow), [users]);
  const roles = useMemo(() => new Set(["StudentEnrollment", ...rows.flatMap((row) => [...row.roles])]), [rows]);
  const orderedRows = useMemo(() => {
    if (!sort) return rows;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = memberSortValue(a, sort.key);
      const right = memberSortValue(b, sort.key);
      const missing = (value: typeof left) => value == null || value === "" || Number.isNaN(value);
      if (missing(left)) return missing(right) ? 0 : 1;
      if (missing(right)) return -1;
      return direction * (typeof left === "number" && typeof right === "number"
        ? left - right
        : memberCollator.compare(String(left), String(right)));
    });
  }, [rows, sort]);
  const filteredRows = useMemo(() => orderedRows.filter((row) => columns.every(({ key, kind }) => {
    const filter = filters[key]?.trim();
    if (!filter) return true;
    if (kind === "role") return filter === "unknown" ? !row.roles.size : row.roles.has(filter);
    if (kind === "date") return row.cells[key].slice(0, 10).replace(/\//g, "-") === filter;
    return row.cells[key].toLowerCase().includes(filter.toLowerCase());
  })), [filters, orderedRows]);
  const filteredUsers = useMemo(() => filteredRows.map(({ user }) => user), [filteredRows]);
  const selectedUsers = useMemo(
    () => orderedRows.map(({ user }) => user).filter((user) => selectedUserIds.has(user.id)),
    [orderedRows, selectedUserIds]
  );
  const visibleSelectedCount = filteredUsers.filter((user) => selectedUserIds.has(user.id)).length;
  const paginatedRows = filteredRows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const hasFilters = Object.values(filters).some((filter) => filter?.trim());

  const changeSort = (key: SortColumn) => {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(0);
  };

  const changeFilter = (column: MemberColumn["key"], value: string) => {
    setFilters((current) => ({ ...current, [column]: value }));
    setPage(0);
  };

  const toggleMembers = (members: User[], checked: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      for (const member of members) {
        if (checked) next.add(member.id);
        else next.delete(member.id);
      }
      return next;
    });
  };

  const handleExport = async (exportAll: boolean) => {
    if (!exportConfig.save_name?.trim()) {
      messageApi.error("请输入导出文件名");
      return;
    }
    const exportUsers = exportAll ? filteredUsers : selectedUsers;
    if (exportUsers.length === 0) return;

    try {
      await invoke("export_users", {
        users: exportUsers,
        saveName: `${exportConfig.save_name}.xlsx`,
        ...(selectedCourse ? { course: downloadCourseContext(selectedCourse) } : {}),
      });
      messageApi.success("导出成功", 0.5);
    } catch (error) {
      messageApi.error(error as string);
    }
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Stack spacing={2}>
        <WorkspaceHero
          chipLabel="成员导出"
          chipIcon={<GroupRoundedIcon />}
          title="课程成员"
          description="筛选课程成员并导出 Excel 名单。"
          aside={
            <Box sx={{ width: { xs: "100%", lg: 640 } }}>
              <CourseSelect
                onChange={setSelectedCourseId}
                disabled={Boolean(selectedCourse && operating)}
                courses={courses.data}
                value={selectedCourse?.id}
              />
            </Box>
          }
        />

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 }, "&:last-child": { pb: 2 } }}>
            <Stack spacing={1.25}>
              {selectedCourse && operating ? (
                <TableSkeleton rows={8} cols={10} />
              ) : selectedCourse && users.length > 0 ? (
                <>
                  <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
                    <TextField
                      size="small"
                      label="导出文件名"
                      value={exportConfig.save_name}
                      onChange={(event) => setExportConfig({ ...exportConfig, save_name: event.target.value })}
                      InputProps={{ endAdornment: <InputAdornment position="end">.xlsx</InputAdornment> }}
                      sx={{ width: { xs: "100%", sm: 225 } }}
                    />
                    <Button size="small" variant="outlined" disabled={!filteredUsers.length} onClick={() => void handleExport(true)}>
                      {hasFilters ? "导出筛选结果" : "导出全部"}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      disabled={operating || selectedUsers.length === 0}
                      onClick={() => void handleExport(false)}
                    >
                      导出所选
                    </Button>
                  </Stack>
                  <Box
                    sx={{
                      borderRadius: "8px",
                      border: "1px solid",
                      borderColor: "divider",
                      overflow: "auto",
                    }}
                  >
                    <Table
                      size="small"
                      aria-label="课程成员"
                      sx={{
                        minWidth: 1000,
                        "& .MuiTableCell-root": { px: 1.25, py: 0.5 },
                        "& .MuiTableCell-paddingCheckbox": { width: 36, p: 0 },
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              sx={{ p: 0.75 }}
                              inputProps={{ "aria-label": "选择全部筛选结果" }}
                              disabled={!filteredUsers.length}
                              checked={filteredUsers.length > 0 && visibleSelectedCount === filteredUsers.length}
                              indeterminate={visibleSelectedCount > 0 && visibleSelectedCount < filteredUsers.length}
                              onChange={(event) => toggleMembers(filteredUsers, event.target.checked)}
                            />
                          </TableCell>
                          {columns.map((column) => (
                            <TableCell key={column.key} sortDirection={sort?.key === column.key ? sort.direction : false} sx={{ whiteSpace: "nowrap" }}>
                              <Stack direction="row" alignItems="center" gap={0.25}>
                                {"sortable" in column ? (
                                  <TableSortLabel
                                    active={sort?.key === column.key}
                                    direction={sort?.key === column.key ? sort.direction : "asc"}
                                    aria-label={`按${column.label}排序`}
                                    onClick={() => changeSort(column.key)}
                                  >
                                    {column.label}
                                  </TableSortLabel>
                                ) : column.label}
                                {column.kind === "role" && filters.role && (
                                  <Typography variant="caption" color="text.secondary">
                                    {filters.role === "unknown" ? "未知" : roleNames.get(filters.role) ?? filters.role}
                                  </Typography>
                                )}
                                <Tooltip title={filters[column.key] ? `${column.label}已筛选` : `筛选${column.label}`}>
                                  <IconButton
                                    size="small"
                                    color={filters[column.key] ? "primary" : "default"}
                                    aria-label={`筛选${column.label}`}
                                    aria-haspopup="dialog"
                                    aria-expanded={filterMenu?.column.key === column.key}
                                    onClick={(event) => setFilterMenu({ column, anchor: event.currentTarget })}
                                    sx={{ p: 0.5 }}
                                  >
                                    <FilterAltOutlinedIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {!filteredUsers.length && (
                          <TableRow>
                            <TableCell colSpan={10} align="center">没有匹配的成员</TableCell>
                          </TableRow>
                        )}
                        {paginatedRows.map(({ user, cells }) => {
                          const checked = selectedUserIds.has(user.id);
                          return (
                            <TableRow key={user.id} hover selected={checked}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  size="small"
                                  sx={{ p: 0.75 }}
                                  inputProps={{ "aria-label": `选择 ${user.name}` }}
                                  checked={checked}
                                  onChange={(event) => toggleMembers([user], event.target.checked)}
                                />
                              </TableCell>
                              {columns.map(({ key, kind }) => (
                                <TableCell key={key} sx={{ fontWeight: key === "name" ? 700 : undefined, whiteSpace: kind === "date" ? "nowrap" : undefined }}>
                                  {cells[key] || (key === "role" ? "未知" : "—")}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                  {filterMenu && (
                    <Popover
                      open
                      anchorEl={filterMenu.anchor}
                      onClose={() => setFilterMenu(null)}
                      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                      slotProps={{ paper: { role: "dialog", "aria-label": `筛选${filterMenu.column.label}` } }}
                    >
                      {filterMenu.column.kind === "role" ? (
                        <MenuList autoFocusItem>
                          {[["", "全部身份"], ...[...roles].map((role) => [role, roleNames.get(role) ?? role]),
                            ...(rows.some((row) => !row.roles.size) ? [["unknown", "未知"]] : [])].map(([role, label]) => (
                            <MenuItem
                              key={role}
                              selected={(filters.role ?? "") === role}
                              onClick={() => {
                                changeFilter("role", role);
                                setFilterMenu(null);
                              }}
                            >
                              {label}
                            </MenuItem>
                          ))}
                        </MenuList>
                      ) : (
                        <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1.5 }}>
                          <TextField
                            autoFocus
                            size="small"
                            label={filterMenu.column.label}
                            type={filterMenu.column.kind === "date" ? "date" : "search"}
                            slotProps={{ inputLabel: { shrink: filterMenu.column.kind === "date" || undefined } }}
                            value={filters[filterMenu.column.key] ?? ""}
                            onChange={(event) => changeFilter(filterMenu.column.key, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") setFilterMenu(null);
                            }}
                          />
                          <Button size="small" onClick={() => changeFilter(filterMenu.column.key, "")}>清除</Button>
                        </Stack>
                      )}
                    </Popover>
                  )}

                  <Stack direction="row" flexWrap="wrap" alignItems="center" justifyContent="space-between" columnGap={2}>
                    <Typography variant="body2" color="text.secondary" aria-live="polite" sx={{ px: 1 }}>
                      {selectedUsers.length > 0 && `已选 ${selectedUsers.length} 人`}
                      {selectedUsers.length > visibleSelectedCount && `（含 ${selectedUsers.length - visibleSelectedCount} 人不在筛选结果中）`}
                    </Typography>
                    <TablePagination
                      component="div"
                      count={filteredUsers.length}
                      page={page}
                      onPageChange={(_, nextPage) => setPage(nextPage)}
                      rowsPerPage={rowsPerPage}
                      onRowsPerPageChange={(event) => {
                        setRowsPerPage(Number(event.target.value));
                        setPage(0);
                      }}
                      rowsPerPageOptions={[10, 20, 50, 100, 200, 500]}
                      labelRowsPerPage="每页"
                      labelDisplayedRows={({ from, to, count }) => count ? `${from}–${to}，共 ${count} 人` : "共 0 人"}
                      getItemAriaLabel={(type) => type === "previous" ? "上一页" : "下一页"}
                      sx={{ "& .MuiTablePagination-toolbar": { pl: 0, minHeight: 36 } }}
                    />
                  </Stack>
                </>
              ) : (
                <Alert severity="info">
                  {selectedCourse ? "本课程暂无成员" : "请选择课程"}
                </Alert>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </BasicLayout>
  );
}
