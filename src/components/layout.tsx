import { getVersion } from "@tauri-apps/api/app";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import ChecklistRoundedIcon from "@mui/icons-material/ChecklistRounded";
import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import GradingRoundedIcon from "@mui/icons-material/GradingRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import SystemUpdateAltRoundedIcon from "@mui/icons-material/SystemUpdateAltRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import WidgetsRoundedIcon from "@mui/icons-material/WidgetsRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import DeveloperBoardRoundedIcon from "@mui/icons-material/DeveloperBoardRounded";
import {
  Box,
  Badge,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useAppMessage } from "../lib/message";
import { useEffect, useId, useState, type PropsWithChildren } from "react";
import { Link, useLocation } from "react-router-dom";

import { useConfigSelector } from "../lib/hooks";
import { checkForUpdates } from "../lib/utils";
import { useUpdateNotice } from "../lib/update_notice";
import { ChangeLogModal } from "./change_log_modal";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import { useTasks } from "../lib/task_hooks";
import { isTaskActive, taskManager } from "../lib/task_manager";
import TaskPopover from "./task_popover";
import LogModal from "./log_modal";

const drawerWidth = 248;
const collapsedDrawerWidth = 76;

const utilityButtonSx = {
  flex: 1, minWidth: 0, minHeight: 36, borderRadius: "9px",
  px: 0.5, gap: 0.75, color: "text.secondary", fontSize: 13,
  whiteSpace: "nowrap",
  "&[aria-current=\"page\"], &[aria-expanded=\"true\"]": { color: "primary.main", bgcolor: "action.selected" },
};

const navigationItems = [
  { key: "agent", label: "Canvas Agent", icon: <PsychologyRoundedIcon />, path: "/agent" },
  { key: "files", label: "文件管理", icon: <FolderRoundedIcon />, path: "/files" },
  { key: "assignments", label: "作业列表", icon: <ChecklistRoundedIcon />, path: "/assignments" },
  { key: "calendar", label: "日程管理", icon: <CalendarMonthRoundedIcon />, path: "/calendar" },
  { key: "grades", label: "成绩管理", icon: <FactCheckRoundedIcon />, path: "/grades" },
  { key: "submissions", label: "提交批改", icon: <GradingRoundedIcon />, path: "/submissions" },
  { key: "video", label: "视频管理", icon: <SmartDisplayRoundedIcon />, path: "/video" },
  { key: "annual", label: "年度总结", icon: <TimelineRoundedIcon />, path: "/annual" },
];

const otherTools = [
  { key: "discussions", label: "讨论管理", icon: <ForumRoundedIcon />, path: "/discussions" },
  { key: "users", label: "成员导出", icon: <GroupsRoundedIcon />, path: "/users" },
  { key: "syllabus", label: "教学大纲", icon: <AutoStoriesRoundedIcon />, path: "/syllabus" },
  { key: "qrcode", label: "二维码管理", icon: <QrCode2RoundedIcon />, path: "/qrcode" },
];

const pageTitleMap: Record<string, string> = {
  agent: "Canvas Agent",
  files: "文件管理",
  assignments: "作业列表",
  discussions: "讨论管理",
  calendar: "日程管理",
  users: "成员导出",
  grades: "成绩管理",
  submissions: "提交批改",
  syllabus: "教学大纲",
  video: "视频管理",
  qrcode: "二维码管理",
  annual: "年度总结",
  settings: "系统设置",
  debug: "Debug 控制台",
};

export function AppShell({ children }: PropsWithChildren) {
  const tasks = useTasks();
  const activeTasks = tasks.filter(isTaskActive);
  const activeTaskCount = activeTasks.length;
  const currentBatch = activeTasks[0]?.batch;
  const batchTasks = currentBatch === undefined ? activeTasks : tasks.filter((task) => task.batch === currentBatch);
  const batchProgress = batchTasks.length && !activeTasks.some((task) => task.status === "running" && task.progress === undefined)
    ? Math.round(batchTasks.reduce((sum, task) => sum + (isTaskActive(task) ? task.progress ?? 0 : 100), 0) / batchTasks.length)
    : undefined;
  const progressText = activeTaskCount ? (batchProgress === undefined ? " · 总进度待定" : " · 总进度 " + batchProgress + "%") : "";
  const failedTaskCount = tasks.filter((task) => task.status === "failed").length;
  const unreadTaskCount = tasks.filter((task) => task.unreadCompletion).length;
  const [taskAnchor, setTaskAnchor] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const config = useConfigSelector((state) => state.config.data);
  const taskCenterEnabled = config?.experimental_task_center_only === true;
  useEffect(() => {
    if (!taskCenterEnabled) setTaskAnchor(null);
  }, [taskCenterEnabled]);
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const isCompactWindow = useMediaQuery(theme.breakpoints.down("sm"));
  const location = useLocation();
  const currentKey = location.pathname.split("/").filter(Boolean).pop() || "files";
  const currentTitle = pageTitleMap[currentKey] || "Canvas";
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const toolsMenuId = useId();
  const [supportAnchor, setSupportAnchor] = useState<HTMLElement | null>(null);
  const supportMenuId = useId();
  const toolSelected = otherTools.some((item) => item.key === currentKey);
  const [version, setVersion] = useState("");
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const compactRail = isDesktop && collapsed;
  const [messageApi, contextHolder] = useAppMessage();
  const { availableVersion, setAvailableVersion, previewOnly } = useUpdateNotice();

  useEffect(() => {
    void getVersion().then(setVersion, () => undefined);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setToolsAnchor(null);
    setSupportAnchor(null);
    setTaskAnchor(null);
  }, [isDesktop, location.pathname]);

  const effectiveDrawerWidth = compactRail ? collapsedDrawerWidth : isCompactWindow ? 244 : drawerWidth;
  const drawerWidthTransition = theme.transitions.create("width", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.short,
  });

  const handleCheckForUpdates = () => {
    setSupportAnchor(null);
    if (previewOnly) {
      messageApi.info(availableVersion
        ? "开发预览：模拟发现 v" + availableVersion + "，不会下载安装。"
        : "开发预览模式不会下载安装更新。");
      return;
    }
    void checkForUpdates(messageApi, setAvailableVersion);
  };

  const navigationButtonSx = {
    minHeight: 32, px: compactRail ? 0.75 : 1, py: 0, borderRadius: "8px",
    "& .MuiListItemIcon-root": { minWidth: compactRail ? 0 : 28, color: "inherit", justifyContent: "center" },
    "& .MuiSvgIcon-root": { fontSize: 18 },
    "& .MuiListItemText-root": { my: 0, ml: 0.5 },
    justifyContent: compactRail ? "center" : "flex-start",
    transition: "background-color 0.16s ease, color 0.16s ease",
    "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "action.selected", color: "primary.main" },
  };
  const taskButton = taskCenterEnabled && (
    <Tooltip title={`任务中心 · 进行中 ${activeTaskCount} · 需处理 ${failedTaskCount}${progressText}`}>
      <ListItemButton selected={!!taskAnchor} onClick={(event) => {
        taskManager.markCompletionsRead();
        setTaskAnchor(event.currentTarget);
      }} aria-haspopup="dialog" aria-expanded={!!taskAnchor}
        aria-label={`任务中心，进行中 ${activeTaskCount}，需处理 ${failedTaskCount}，新完成 ${unreadTaskCount}${progressText}`}
        sx={navigationButtonSx}
      >
        <ListItemIcon sx={{ "& .MuiSvgIcon-root": { color: failedTaskCount ? "error.main" : undefined } }}>
          <Badge badgeContent={taskAnchor ? 0 : unreadTaskCount} color="error" max={99}
            sx={{ "& .MuiBadge-badge": { top: 3, right: 3, minWidth: 14, height: 14, px: 0.375, fontSize: 9 } }}>
            <Box sx={{ position: "relative", display: "grid", placeItems: "center", width: 26, height: 26 }}>
              {activeTaskCount > 0 && <>
                <CircularProgress variant="determinate" value={100} size={26} thickness={3} aria-hidden
                  sx={{ position: "absolute", inset: 0, color: "action.disabledBackground" }} />
                <CircularProgress variant={batchProgress === undefined ? "indeterminate" : "determinate"}
                  value={batchProgress} size={26} thickness={3} aria-label="任务总进度"
                  sx={{ position: "absolute", inset: 0 }} />
              </>}
              <DownloadRoundedIcon sx={{ fontSize: 17 }} />
            </Box>
          </Badge>
        </ListItemIcon>
        {!compactRail && <ListItemText primary="任务中心" slotProps={{ primary: { fontSize: 13.5, lineHeight: 1.35 } }} />}
      </ListItemButton>
    </Tooltip>
  );
  const drawerContent = (
    <Stack
      sx={{
        height: "100%",
        width: "100%",
        p: compactRail ? 1 : 1.5,
        gap: 0.75,
        overflow: "hidden",
        color: "text.primary",
        borderRight: "1px solid",
        borderColor: "divider",
      }}
    >
        <Stack direction="row" alignItems="center" justifyContent={compactRail ? "center" : "space-between"} sx={{ minHeight: 38, px: compactRail ? 0 : 0.5, flexShrink: 0 }}>
          {!compactRail && (
            <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
              <Box sx={{
                width: 34, height: 34, borderRadius: "10px", display: "grid", placeItems: "center", flexShrink: 0,
                color: "primary.main", bgcolor: alpha(theme.palette.primary.main, 0.1),
                "& svg": { fontSize: 20 },
              }}>
                <GridViewRoundedIcon />
              </Box>
              <Typography variant="subtitle2" fontWeight={700} noWrap>Canvas Helper</Typography>
            </Stack>
          )}
          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ flexShrink: 0 }}>
            <Tooltip title={isDesktop ? (compactRail ? "展开侧栏" : "收起侧栏") : "关闭导航"}>
              <IconButton aria-label={isDesktop ? (compactRail ? "展开侧栏" : "收起侧栏") : "关闭导航"}
                onClick={() => isDesktop ? setCollapsed((previous) => !previous) : setMobileOpen(false)}
                sx={{ width: 26, height: 26, p: 0, "& .MuiSvgIcon-root": { fontSize: 18 } }}>
                {compactRail ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <List component="nav" aria-label="功能导航" sx={{
          p: 0, display: "flex", flexDirection: "column", gap: 0.25, minHeight: 0, overflowY: "auto", overflowX: "hidden",
          "& .MuiListItemButton-root": { flexShrink: 0 },
        }}>
          {navigationItems.map((item) => {
            const selected = currentKey === item.key;
            const button = (
              <ListItemButton
                component={Link}
                to={item.path}
                aria-label={item.label}
                selected={selected}
                aria-current={selected ? "page" : undefined}
                sx={navigationButtonSx}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                {compactRail ? null : (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: 13.5,
                      fontWeight: selected ? 700 : 500,
                      lineHeight: 1.35,
                      noWrap: true,
                    }}
                  />
                )}
              </ListItemButton>
            );

            return (
              <Tooltip key={item.key} title={compactRail ? item.label : ""} placement="right">
                {button}
              </Tooltip>
            );
          })}
          <Tooltip title={compactRail ? "其他工具" : ""} placement="right">
            <ListItemButton selected={toolSelected || !!toolsAnchor} aria-label="其他工具"
              aria-haspopup="menu" aria-expanded={!!toolsAnchor} aria-controls={toolsAnchor ? toolsMenuId : undefined}
              onClick={(event) => setToolsAnchor(event.currentTarget)}
              sx={navigationButtonSx}>
              <ListItemIcon>
                <WidgetsRoundedIcon />
              </ListItemIcon>
              {!compactRail && <>
                <ListItemText primary="其他工具" slotProps={{ primary: { fontSize: 13.5, lineHeight: 1.35, fontWeight: toolSelected ? 700 : 500 } }} />
                <ExpandMoreRoundedIcon fontSize="small" />
              </>}
            </ListItemButton>
          </Tooltip>
        </List>
        <Menu
          id={toolsMenuId} anchorEl={toolsAnchor} open={!!toolsAnchor} onClose={() => setToolsAnchor(null)}
          anchorOrigin={isDesktop ? { vertical: "center", horizontal: "right" } : { vertical: "bottom", horizontal: "left" }}
          transformOrigin={isDesktop ? { vertical: "center", horizontal: "left" } : { vertical: "top", horizontal: "left" }}
        >
          {otherTools.map((item) => (
            <MenuItem key={item.key} component={Link} to={item.path} selected={currentKey === item.key}
              aria-current={currentKey === item.key ? "page" : undefined} onClick={() => setToolsAnchor(null)}>
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText>{item.label}</ListItemText>
            </MenuItem>
          ))}
        </Menu>

        <Stack spacing={0.75} sx={{
          flexShrink: 0, mt: "auto", pt: 1, borderTop: "1px solid", borderColor: "divider",
          pb: "env(safe-area-inset-bottom, 0px)",
        }}>
          <Stack direction="row" spacing={0.25}>
            <Tooltip title="系统设置">
              <Button component={Link} to="/settings" aria-label="系统设置"
                aria-current={currentKey === "settings" ? "page" : undefined} sx={utilityButtonSx}>
                <SettingsRoundedIcon fontSize="small" />
                {!compactRail && "设置"}
              </Button>
            </Tooltip>
            <Tooltip title={availableVersion ? "关于与支持 · 有新版本 " + availableVersion : "关于与支持"}>
              <Button sx={utilityButtonSx} aria-label="关于与支持" aria-haspopup="menu"
                aria-expanded={!!supportAnchor} aria-controls={supportAnchor ? supportMenuId : undefined}
                onClick={(event) => setSupportAnchor(event.currentTarget)}>
                <Badge color="error" variant="dot" invisible={!availableVersion}>
                  <HelpOutlineRoundedIcon fontSize="small" />
                </Badge>
                {!compactRail && "关于与支持"}
              </Button>
            </Tooltip>
          </Stack>
          {taskButton}
        </Stack>

        <Menu id={supportMenuId} anchorEl={supportAnchor} open={!!supportAnchor} onClose={() => setSupportAnchor(null)}
          anchorOrigin={{ vertical: "top", horizontal: "right" }} transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        >
          <Box component="li" sx={{ listStyle: "none", px: 2, pt: 0.25, pb: 0.75 }}>
            <Typography variant="caption" color="text.secondary">Canvas Helper {version ? "v" + version : ""}</Typography>
          </Box>
          <Divider component="li" />
          <MenuItem onClick={handleCheckForUpdates}>
            <ListItemIcon><SystemUpdateAltRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="检查更新" secondary={availableVersion ? "新版本 v" + availableVersion : undefined} />
          </MenuItem>
          <MenuItem onClick={() => { setSupportAnchor(null); setShowChangeLog(true); }}>
            <ListItemIcon><HistoryRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>更新日志</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setSupportAnchor(null); setShowLogModal(true); }}>
            <ListItemIcon><ForumRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>反馈</ListItemText>
          </MenuItem>
          {config?.debug_mode && (
            <MenuItem component={Link} to="/debug" aria-current={currentKey === "debug" ? "page" : undefined}
              onClick={() => setSupportAnchor(null)}>
              <ListItemIcon><DeveloperBoardRoundedIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Debug 控制台</ListItemText>
            </MenuItem>
          )}
        </Menu>
      </Stack>
    );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", overflowX: "clip" }}>
      {contextHolder}

      <Drawer
        variant={isDesktop ? "permanent" : "temporary"}
        open={isDesktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: effectiveDrawerWidth,
          flexShrink: 0,
          transition: isDesktop ? drawerWidthTransition : undefined,
          "& .MuiDrawer-paper": {
            width: effectiveDrawerWidth,
            border: "none",
            boxSizing: "border-box",
            backgroundColor: "background.paper",
            overflow: "hidden",
            borderRadius: 0,
            transition: drawerWidthTransition,
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          p: { xs: 1.5, md: 2.5 },
        }}
      >
        {!isDesktop ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <IconButton aria-label="打开导航" onClick={() => setMobileOpen(true)}>
              <MenuRoundedIcon />
            </IconButton>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {currentTitle}
            </Typography>
            <Box sx={{ width: 40 }} />
          </Stack>
        ) : null}

        {children}
      </Box>

      <ChangeLogModal
        open={showChangeLog}
        onCancel={() => setShowChangeLog(false)}
        onOk={() => setShowChangeLog(false)}
      />
      {showLogModal && <LogModal onClose={() => setShowLogModal(false)} />}
      {taskCenterEnabled && <TaskPopover anchorEl={taskAnchor} onClose={() => setTaskAnchor(null)} />}
    </Box>
  );
}

export default function BasicLayout({ children, contentKey }: PropsWithChildren<{ contentKey?: string }>) {
  const { pathname } = useLocation();
  return (
    <Box
      key={contentKey ?? pathname}
      className="page-enter"
      sx={{
        p: { xs: 1.5, md: 2.5 },
        minHeight: "calc(100vh - 32px)",
        borderRadius: "16px",
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      {children}
    </Box>
  );
}
