import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import ArticleRoundedIcon from "@mui/icons-material/ArticleRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloudDownloadRoundedIcon from "@mui/icons-material/CloudDownloadRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SmartDisplayRoundedIcon from "@mui/icons-material/SmartDisplayRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import DeveloperBoardRoundedIcon from "@mui/icons-material/DeveloperBoardRounded";
import {
  Box,
  Button,
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
import { useConfigSelector } from "../lib/hooks";
import { checkForUpdates } from "../lib/utils";
import { ChangeLogModal } from "./change_log_modal";

const drawerWidth = 272;
const collapsedDrawerWidth = 92;

const navigationItems = [
  { key: "agent", label: "Canvas Agent", icon: <PsychologyRoundedIcon />, path: "/agent" },
  { key: "files", label: "文件管理", icon: <ArticleRoundedIcon />, path: "/files" },
  { key: "assignments", label: "作业列表", icon: <AssignmentRoundedIcon />, path: "/assignments" },
  { key: "discussions", label: "讨论管理", icon: <ForumRoundedIcon />, path: "/discussions" },
  { key: "calendar", label: "日程管理", icon: <CalendarMonthRoundedIcon />, path: "/calendar" },
  { key: "users", label: "成员导出", icon: <GroupsRoundedIcon />, path: "/users" },
  { key: "grades", label: "成绩管理", icon: <FactCheckRoundedIcon />, path: "/grades" },
  { key: "submissions", label: "提交批改", icon: <CloudDownloadRoundedIcon />, path: "/submissions" },
  { key: "syllabus", label: "教学大纲", icon: <AutoStoriesRoundedIcon />, path: "/syllabus" },
  { key: "video", label: "视频管理", icon: <SmartDisplayRoundedIcon />, path: "/video" },
  { key: "qrcode", label: "二维码管理", icon: <QrCode2RoundedIcon />, path: "/qrcode" },
  { key: "annual", label: "年度总结", icon: <TimelineRoundedIcon />, path: "/annual" },
  { key: "settings", label: "系统设置", icon: <SettingsRoundedIcon />, path: "/settings" },
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

export default function BasicLayout({ children }: React.PropsWithChildren) {
  const theme = useTheme();
  const config = useConfigSelector((state) => state.config.data);
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


  const displayedNavigationItems = useMemo(() => {
    if (!config?.debug_mode) {
      return navigationItems;
    }
    return [
      ...navigationItems.slice(0, -1),
      { key: "debug", label: "Debug 控制台", icon: <DeveloperBoardRoundedIcon />, path: "/debug" },
      ...navigationItems.slice(-1),
    ];
  }, [config?.debug_mode]);
  const drawerContent = (
    <Stack
      sx={{
        height: "100%",
        width: "100%",
        p: 2,
        gap: 2,
        overflowX: "hidden",
        overflowY: "auto",
        color: "text.primary",
        borderRight: "1px solid",
        borderColor: "divider",
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
                width: 34,
                height: 34,
                borderRadius: "10px",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                color: "primary.main",
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                "& svg": { fontSize: 20 },
              }}
            >
              <GridViewRoundedIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Canvas Helper
              </Typography>
            </Box>
          </Stack>

          {isDesktop ? (
            <IconButton onClick={() => setCollapsed((prev) => !prev)} size="small">
              {collapsed ? <ChevronRightRoundedIcon /> : <ChevronLeftRoundedIcon />}
            </IconButton>
          ) : (
            <IconButton onClick={() => setMobileOpen(false)} size="small">
              <ChevronLeftRoundedIcon />
            </IconButton>
          )}
        </Stack>

        <List sx={{ p: 0, display: "grid", gap: 0.5 }}>
          {displayedNavigationItems.map((item, index) => {
            const selected = currentKey === item.key;
            const button = (
              <ListItemButton
                key={item.key}
                component={Link}
                to={item.path}
                selected={selected}
                className="nav-enter"
                style={{ "--rise-delay": `${index * 30}ms` } as React.CSSProperties}
                sx={{
                  minHeight: 42,
                  px: collapsed && isDesktop ? 1.25 : 1.5,
                  py: 0.5,
                  borderRadius: "12px",
                  justifyContent: collapsed && isDesktop ? "center" : "flex-start",
                  color: selected ? "primary.main" : "inherit",
                  transition:
                    "background-color 0.18s ease, color 0.18s ease, transform 0.18s ease",
                  "&:hover": {
                    transform: "translateX(2px)",
                  },
                  "&.Mui-selected": {
                    bgcolor: "action.selected",
                    color: "primary.main",
                    fontWeight: 700,
                    "&:hover": {
                      bgcolor: "action.selected",
                    },
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
                      fontSize: 14.5,
                      fontWeight: selected ? 700 : 500,
                      letterSpacing: "0.02em",
                      lineHeight: 1.45,
                      noWrap: true,
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
          spacing={1}
          sx={{
            pb: `calc(12px + env(safe-area-inset-bottom, 0px))`,
            pt: 0.5,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            v{version || "…"} · Canvas Helper
          </Typography>
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            justifyContent="space-between"
          >
            <Button onClick={() => checkForUpdates(messageApi)} size="small" sx={{ minWidth: 0, px: 1 }}>
              检查更新
            </Button>
            <Button onClick={() => setShowChangeLog(true)} size="small" sx={{ minWidth: 0, px: 1 }}>
              更新日志
            </Button>
            <Button onClick={() => void handleOpenFeedback()} size="small" sx={{ minWidth: 0, px: 1 }}>
              反馈
            </Button>
          </Stack>
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
            backgroundColor: "background.paper",
            overflow: "hidden",
            borderRadius: 0,
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
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {currentTitle}
            </Typography>
            <Box sx={{ width: 40 }} />
          </Stack>
        ) : null}

        <Box
          key={location.pathname}
          className="page-enter"
          sx={{
            p: { xs: 1.5, md: 2.5 },
            minHeight: "calc(100vh - 32px)",
            borderRadius: "16px",
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
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
