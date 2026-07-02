import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeRoundedIcon from "@mui/icons-material/CodeRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import KeyboardArrowUpRoundedIcon from "@mui/icons-material/KeyboardArrowUpRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coy, oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { CODE_LIKE_EXTENSIONS } from "../lib/constants";
import { decodeBase64Data } from "../lib/utils";
import RendererShell from "./renderer_shell";

const LAZY_THRESHOLD_LINES = 5_000;
const LAZY_THRESHOLD_CHARS = 500_000;
const VISIBLE_BUFFER = 20;

export default function CodeRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [showHighlight, setShowHighlight] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const lineHeight = 21;

  const data = useMemo(
    () => currentDocument?.fileData != null ? decodeBase64Data(currentDocument.fileData as string) : "",
    [currentDocument?.fileData]
  );

  const lines = useMemo(() => data.split("\n"), [data]);
  const isLarge = lines.length > LAZY_THRESHOLD_LINES || data.length > LAZY_THRESHOLD_CHARS;

  const matches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const text = data.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while (true) {
      const idx = text.indexOf(q, pos);
      if (idx === -1) break;
      indices.push(idx);
      pos = idx + 1;
    }
    return indices;
  }, [data, searchQuery]);

  useEffect(() => {
    if (currentMatch > 0 && currentMatch >= matches.length) {
      setCurrentMatch(Math.max(0, matches.length - 1));
    }
  }, [matches.length, currentMatch]);

  useEffect(() => {
    if (matches.length === 0 || !containerRef.current) return;
    const idx = matches[currentMatch];
    const textBefore = data.slice(0, idx);
    const lineBreaks = (textBefore.match(/\n/g) || []).length;
    const lineHeight = 21;
    const scrollTarget = lineBreaks * lineHeight - 100;
    containerRef.current.scrollTop = Math.max(0, scrollTarget);
  }, [currentMatch, matches, data]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setSearchQuery("");
        setCurrentMatch(0);
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchNav = useCallback(
    (dir: "next" | "prev") => {
      if (matches.length === 0) return;
      setCurrentMatch((prev) => {
        if (dir === "next") return (prev + 1) % matches.length;
        return (prev - 1 + matches.length) % matches.length;
      });
    },
    [matches.length]
  );

  const renderHighlightedText = useCallback(
    (text: string, isCurrent: (matchIdx: number) => boolean) => {
      if (!searchQuery.trim()) {
        return (
          <Typography
            component="code"
            variant="body2"
            sx={{ fontFamily: "inherit", whiteSpace: "pre" }}
          >
            {text}
          </Typography>
        );
      }

      const segments: React.ReactNode[] = [];
      let lastEnd = 0;
      const q = searchQuery.toLowerCase();
      const lowerText = text.toLowerCase();
      let matchCount = -1;

      while (true) {
        const idx = lowerText.indexOf(q, lastEnd);
        if (idx === -1) break;
        matchCount++;

        if (idx > lastEnd) {
          segments.push(<span key={`t-${lastEnd}`}>{text.slice(lastEnd, idx)}</span>);
        }

        const isActive = isCurrent(matchCount);
        segments.push(
          <mark
            key={`m-${idx}`}
            data-match
            data-active={isActive ? "true" : "false"}
            style={{
              backgroundColor: isActive
                ? alpha(theme.palette.warning.main, 0.55)
                : alpha(theme.palette.warning.main, 0.28),
              color: "inherit",
              borderRadius: 2,
              padding: "0 1px",
            }}
          >
            {text.slice(idx, idx + searchQuery.length)}
          </mark>
        );

        lastEnd = idx + searchQuery.length;
      }

      if (lastEnd < text.length) {
        segments.push(<span key={`t-${lastEnd}`}>{text.slice(lastEnd)}</span>);
      }

      return (
        <Typography
          component="code"
          variant="body2"
          sx={{ fontFamily: "inherit", whiteSpace: "pre" }}
        >
          {segments}
        </Typography>
      );
    },
    [searchQuery, theme.palette.warning.main]
  );

  const searchBar = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.5,
        py: 0.5,
        borderBottom: "1px solid",
        borderColor: "divider",
        bgcolor: alpha(theme.palette.background.paper, 0.8),
        backdropFilter: "blur(6px)",
        flexShrink: 0,
      }}
    >
      <TextField
        inputRef={searchRef}
        size="small"
        placeholder="在文件中搜索…"
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value);
          setCurrentMatch(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSearchNav(e.shiftKey ? "prev" : "next");
          }
        }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              </InputAdornment>
            ),
            sx: { fontSize: 13, borderRadius: "10px" },
          },
        }}
        sx={{ width: 220 }}
      />
      {searchQuery.trim() && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48, textAlign: "center" }}>
            {matches.length > 0 ? `${currentMatch + 1}/${matches.length}` : "0/0"}
          </Typography>
          <IconButton size="small" disabled={matches.length === 0} onClick={() => handleSearchNav("prev")}>
            <KeyboardArrowUpRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={matches.length === 0} onClick={() => handleSearchNav("next")}>
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => { setSearchQuery(""); setCurrentMatch(0); searchRef.current?.blur(); }}>
            <Typography variant="caption" sx={{ lineHeight: 1 }}>✕</Typography>
          </IconButton>
        </>
      )}
    </Box>
  );

  const isSearchActive = searchQuery.trim().length > 0;

  const totalHeight = lines.length * lineHeight;
  const visibleLines = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER);
    const end = Math.min(lines.length, Math.ceil((scrollTop + (containerRef.current?.clientHeight ?? 600)) / lineHeight) + VISIBLE_BUFFER);
    return lines.slice(start, end + 1);
  }, [lines, scrollTop]);
  const visibleOffset = useMemo(() => {
    return Math.max(0, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER) * lineHeight;
  }, [scrollTop]);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  const codeContent = (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {searchBar}
      {isSearchActive || (isLarge && !showHighlight) ? (
        <>
          {isLarge && !showHighlight && !isSearchActive && (
            <Typography
              variant="caption"
              sx={{
                px: 2.5,
                py: 1,
                color: "text.secondary",
                bgcolor: alpha(theme.palette.warning.main, 0.08),
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                gap: 1.5,
              }}
            >
              <Box sx={{ flex: 1 }}>
                文件较大（{lines.length} 行），已跳过语法高亮以提升性能。
              </Box>
              <Button size="small" variant="outlined" onClick={() => setShowHighlight(true)}>
                显示语法高亮
              </Button>
            </Typography>
          )}
          <Box
            ref={containerRef}
            onScroll={handleScroll}
            component="pre"
            sx={{
              m: 0,
              p: 2.5,
              flex: 1,
              overflow: "auto",
              fontFamily: "Consolas, Monaco, 'Andale Mono', monospace",
              fontSize: 13,
              lineHeight: `${lineHeight}px`,
              whiteSpace: "pre",
              wordWrap: "normal",
            }}
          >
            <Box sx={{ height: totalHeight, position: "relative" }}>
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${visibleOffset}px)` }}>
                {visibleLines.map((line, i) => (
                  <Box key={i} sx={{ display: "flex" }}>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{
                        minWidth: 48,
                        textAlign: "right",
                        pr: 1.5,
                        color: "text.disabled",
                        userSelect: "none",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                      }}
                    >
                      {Math.max(1, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER + i + 1)}
                    </Typography>
                    {renderHighlightedText(line, (matchIdx) => matchIdx === currentMatch)}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        </>
      ) : (
        <SyntaxHighlighter
            language={(currentDocument as NonNullable<typeof currentDocument>).fileType}
            style={theme.palette.mode === "dark" ? oneDark : coy}
            showLineNumbers
            customStyle={{
              margin: 0,
              minHeight: "100%",
              borderRadius: 16,
              padding: "20px",
              background: "transparent",
              flex: 1,
            }}
          >
            {data}
          </SyntaxHighlighter>
      )}
    </Box>
  );

  if (!currentDocument || currentDocument.fileData === undefined) return null;
  const doc = currentDocument!;

  return (
    <RendererShell
      title={doc.fileName ?? "Code"}
      subtitle="Source preview"
      fileType={doc.fileType}
      icon={<CodeRoundedIcon />}
      headerMode="none"
      contentSx={{ p: 0 }}
    >
      {codeContent}
    </RendererShell>
  );
}

CodeRenderer.fileTypes = CODE_LIKE_EXTENSIONS;
CodeRenderer.weight = 1;
