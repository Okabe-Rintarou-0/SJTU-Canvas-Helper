import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useAppMessage } from "../lib/message";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useKeyPress } from "../lib/hooks";
import { checkForUpdates } from "../lib/utils";
import { ChangeLogModal } from "./change_log_modal";

const drawerWidth = 272;
const collapsedDrawerWidth = 92;

const navigationItems = [
  { key: "files", label: "文件管理", icon: <ArticleRoundedIcon />, path: "/files" },
  { key: "assignments", label: "作业列表", icon: <AssignmentRoundedIcon />, path: "/assignments" },
  { key: "discussions", label: "讨论管理", icon: <ForumRoundedIcon />, path: "/discussions" },
  { key: "calendar", label: "日程管理", icon: <CalendarMonthRoundedIcon />, path: "/calendar" },
  { key: "users", label: "成员导出", icon: <GroupsRoundedIcon />, path: "/users" },
  { key: "grades", label: "成绩管理", icon: <FactCheckRoundedIcon />, path: "/grades" },
  { key: "submissions", label: "提交批改", icon: <CloudDownloadRoundedIcon />, path: "/submissions" },
  { key: "video", label: "视频管理", icon: <SmartDisplayRoundedIcon />, path: "/video" },
  { key: "qrcode", label: "二维码管理", icon: <QrCode2RoundedIcon />, path: "/qrcode" },
  { key: "annual", label: "年度总结", icon: <TimelineRoundedIcon />, path: "/annual" },
  { key: "settings", label: "系统设置", icon: <SettingsRoundedIcon />, path: "/settings" },
];

const pageTitleMap: Record<string, string> = {
  files: "文件管理",
  assignments: "作业列表",
  discussions: "讨论管理",
  calendar: "日程管理",
  users: "成员导出",
  grades: "成绩管理",
  submissions: "提交批改",
  video: "视频管理",
  qrcode: "二维码管理",
  annual: "年度总结",
  settings: "系统设置",
};

export default function BasicLayout({ children }: React.PropsWithChildren) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const isCompactWindow = useMediaQuery(theme.breakpoints.down("sm"));
  const location = useLocation();
  const currentKey = location.pathname.split("/").filter(Boolean).pop() || "files";
  const currentTitle = pageTitleMap[currentKey] || "Canvas";
  const [version, setVersion] = useState("");
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [scale, setScale] = useState(1);
  const [messageApi, contextHolder] = useAppMessage();

  useEffect(() => {
    getVersion().then((value) => setVersion(value));
  }, []);

  useEffect(() => {
    if (isDesktop) {
      setMobileOpen(false);
    }
  }, [isDesktop, location.pathname]);

  const handleOpenFeedback = async () => {
    try {
      await openExternal("mailto:923048992@sjtu.edu.cn");
    } catch (error) {
      console.error("open feedback mail failed", error);
      messageApi.error("未能打开反馈邮箱，请确认系统已配置邮件客户端。");
    }
  };

  const zoomIn = () => setScale((prevScale) => prevScale + 0.1);
  const zoomOut = () => setScale((prevScale) => Math.max(0.1, prevScale - 0.1));

  useKeyPress("=", zoomIn);
  useKeyPress("-", zoomOut);

  const effectiveDrawerWidth = useMemo(() => {
    if (!isDesktop) {
      return isCompactWindow ? 244 : drawerWidth;
    }
    return collapsed ? collapsedDrawerWidth : drawerWidth;
  }, [collapsed, isCompactWindow, isDesktop]);

  const drawerContent = (
    <Stack
      sx={{
        height: "100%",
        width: "100%",
        p: 2,
        gap: 2,
        overflowX: "hidden",
        overflowY: "auto",
        color: theme.palette.mode === "dark" ? "#e2e8f0" : "text.primary",
        bgcolor:
          theme.palette.mode === "dark"
            ? "rgba(8, 13, 24, 0.985)"
            : alpha("#f8fbff", 0.96),
        borderRight:
          theme.palette.mode === "dark"
            ? "1px solid rgba(148, 163, 184, 0.08)"
            : `1px solid ${alpha(theme.palette.divider, 0.5)}`,
        boxShadow:
          theme.palette.mode === "dark"
            ? "inset -1px 0 0 rgba(148, 163, 184, 0.06), 18px 0 40px rgba(2, 6, 23, 0.32)"
            : "none",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.25}
          sx={{
            minWidth: 0,
            opacity: collapsed && isDesktop ? 0 : 1,
            transition: "opacity 0.2s ease",
          }}
        >
          <Box
            sx={{
              width: 42,
              height: 42,
              borderRadius: "16px",
              display: "grid",
              placeItems: "center",
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              color: "primary.main",
            }}
          >
            <GridViewRoundedIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Canvas Helper
            </Typography>
            <Typography
              variant="caption"
              color={theme.palette.mode === "dark" ? "rgba(226,232,240,0.66)" : "text.secondary"}
            >
              Workspace
            </Typography>
          </Box>
        </Stack>

        {isDesktop ? (
          <IconButton onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />}
          </IconButton>
        ) : (
          <IconButton onClick={() => setMobileOpen(false)}>
            <ChevronLeftRoundedIcon />
          </IconButton>
        )}
      </Stack>

      {!collapsed || !isDesktop ? (
        <Chip
          label={currentTitle}
          color="primary"
          variant="outlined"
          sx={{
            width: "fit-content",
            bgcolor:
              theme.palette.mode === "dark"
                ? alpha(theme.palette.primary.main, 0.12)
                : undefined,
            borderColor:
              theme.palette.mode === "dark"
                ? alpha(theme.palette.primary.main, 0.28)
                : undefined,
          }}
        />
      ) : null}

      <List sx={{ p: 0, display: "grid", gap: 0.75 }}>
        {navigationItems.map((item) => {
          const selected = currentKey === item.key;
          const button = (
            <ListItemButton
              key={item.key}
              component={Link}
              to={item.path}
              selected={selected}
              sx={{
                minHeight: 52,
                px: collapsed && isDesktop ? 1.25 : 1.5,
                py: 1,
                borderRadius: "18px",
                justifyContent: collapsed && isDesktop ? "center" : "flex-start",
                color:
                  theme.palette.mode === "dark"
                    ? alpha("#e2e8f0", selected ? 1 : 0.86)
                    : "inherit",
                "&.Mui-selected": {
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.primary.main, 0.2)
                      : alpha(theme.palette.primary.main, 0.12),
                  color: "primary.main",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}`
                      : "none",
                },
                "&:hover": {
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha("#94a3b8", 0.12)
                      : alpha(theme.palette.primary.main, 0.04),
                },
                "&.Mui-selected:hover": {
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.primary.main, 0.24)
                      : alpha(theme.palette.primary.main, 0.16),
                },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: collapsed && isDesktop ? 0 : 38,
                  color: "inherit",
                  justifyContent: "center",
                }}
              >
                {item.icon}
              </ListItemIcon>
              {collapsed && isDesktop ? null : (
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: 15,
                    fontWeight: selected ? 700 : 500,
                  }}
                />
              )}
            </ListItemButton>
          );

          return collapsed && isDesktop ? (
            <Tooltip key={item.key} title={item.label} placement="right">
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>

      <Box sx={{ flex: 1 }} />

      <Divider sx={{ mt: 0.5 }} />

      <Stack
        spacing={1.25}
        sx={{
          pb: `calc(12px + env(safe-area-inset-bottom, 0px))`,
          pt: 0.5,
        }}
      >
        {!collapsed || !isDesktop ? (
          <>
            <Typography variant="caption" color="text.secondary">
              当前版本 {version || "读取中"}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                onClick={() => checkForUpdates(messageApi)}
                variant="outlined"
                size="small"
                sx={
                  theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined
                }
              >
                检查更新
              </Button>
              <Button
                onClick={() => setShowChangeLog(true)}
                variant="outlined"
                size="small"
                sx={
                  theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined
                }
              >
                更新日志
              </Button>
              <Button
                onClick={() => void handleOpenFeedback()}
                variant="outlined"
                size="small"
                sx={
                  theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined
                }
              >
                我要反馈
              </Button>
            </Stack>
          </>
        ) : (
          <Stack spacing={1} alignItems="center">
            <Tooltip title="检查更新">
              <Button
                onClick={() => checkForUpdates(messageApi)}
                variant="outlined"
                size="small"
                sx={{
                  minWidth: 0,
                  px: 1.2,
                  ...(theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined),
                }}
              >
                更
              </Button>
            </Tooltip>
            <Tooltip title="更新日志">
              <Button
                onClick={() => setShowChangeLog(true)}
                variant="outlined"
                size="small"
                sx={{
                  minWidth: 0,
                  px: 1.2,
                  ...(theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined),
                }}
              >
                志
              </Button>
            </Tooltip>
            <Tooltip title="我要反馈">
              <Button
                onClick={() => void handleOpenFeedback()}
                variant="outlined"
                size="small"
                sx={{
                  minWidth: 0,
                  px: 1.2,
                  ...(theme.palette.mode === "dark"
                    ? {
                        borderColor: alpha("#94a3b8", 0.2),
                        color: alpha("#e2e8f0", 0.92),
                      }
                    : undefined),
                }}
              >
                反
              </Button>
            </Tooltip>
          </Stack>
        )}
      </Stack>
    </Stack>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {contextHolder}

      <Drawer
        variant={isDesktop ? "permanent" : "temporary"}
        open={isDesktop ? true : mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: effectiveDrawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: effectiveDrawerWidth,
            border: "none",
            boxSizing: "border-box",
            backgroundColor:
              theme.palette.mode === "dark"
                ? "rgba(8, 13, 24, 0.985)"
                : alpha("#f8fbff", 0.98),
            overflow: "hidden",
            transition: theme.transitions.create("width", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.standard,
            }),
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
            <IconButton onClick={() => setMobileOpen(true)}>
              <MenuRoundedIcon />
            </IconButton>
            <Chip label={currentTitle} color="primary" variant="outlined" />
            <Box sx={{ width: 40 }} />
          </Stack>
        ) : null}

        <Box
          sx={{
            p: { xs: 1.5, md: 2.5 },
            minHeight: "calc(100vh - 32px)",
            borderRadius: { xs: "24px", md: "30px" },
            bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.9 : 0.88),
            border: "1px solid transparent",
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 24px 60px rgba(2, 8, 23, 0.32)"
                : "0 24px 60px rgba(15, 23, 42, 0.06)",
            backdropFilter: "blur(18px)",
            zoom: scale,
            transformOrigin: "top left",
          }}
        >
          {children}
        </Box>
      </Box>

      <ChangeLogModal
        open={showChangeLog}
        onCancel={() => setShowChangeLog(false)}
        onOk={() => setShowChangeLog(false)}
      />
    </Box>
  );
}
