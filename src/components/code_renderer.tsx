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

function highlightDom(container: HTMLElement, query: string, activeIdx: number) {
  container.querySelectorAll("mark.code-search-mark").forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(el.textContent ?? ""), el);
      parent.normalize();
    }
  });

  if (!query.trim()) return;

  const q = query.toLowerCase();
  let matchCount = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const toWrap: { text: Text; startIdx: number }[] = [];
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    const content = text.textContent ?? "";
    const lower = content.toLowerCase();
    let pos = 0;
    while (true) {
      const idx = lower.indexOf(q, pos);
      if (idx === -1) break;
      toWrap.push({ text, startIdx: idx });
      pos = idx + 1;
    }
  }

  toWrap.sort((a, b) => b.startIdx - a.startIdx);

  for (const { text, startIdx } of toWrap) {
    const content = text.textContent ?? "";
    const endIdx = startIdx + query.length;
    const after = content.slice(endIdx);
    const match = content.slice(startIdx, endIdx);
    const before = content.slice(0, startIdx);
    const isActive = matchCount === activeIdx;

    const mark = document.createElement("mark");
    mark.className = "code-search-mark";
    mark.textContent = match;
    mark.style.backgroundColor = isActive ? "rgba(245,158,11,0.55)" : "rgba(245,158,11,0.28)";
    mark.style.color = "inherit";
    mark.style.borderRadius = "2px";
    mark.style.padding = "0 1px";

    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(document.createTextNode(after));

    text.parentNode?.replaceChild(frag, text);
    matchCount++;
  }
}

export default function CodeRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const syntaxRef = useRef<HTMLDivElement>(null);
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

  // DOM-based search highlighting for SyntaxHighlighter mode
  useEffect(() => {
    if (isLarge || !syntaxRef.current) return;
    highlightDom(syntaxRef.current, searchQuery, currentMatch);
  }, [searchQuery, currentMatch, data, isLarge]);

  // scroll to current match for SyntaxHighlighter mode
  useEffect(() => {
    if (matches.length === 0 || !syntaxRef.current) return;
    const marks = syntaxRef.current.querySelectorAll("mark.code-search-mark");
    const active = marks[currentMatch] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [currentMatch, matches, data]);

  // scroll to current match for virtual-scroll mode
  useEffect(() => {
    if (matches.length === 0 || !containerRef.current) return;
    const idx = matches[currentMatch];
    const textBefore = data.slice(0, idx);
    const lineBreaks = (textBefore.match(/\n/g) || []).length;
    containerRef.current.scrollTop = Math.max(0, lineBreaks * lineHeight - 200);
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

  const totalHeight = lines.length * lineHeight;
  const visibleLines = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER);
    const end = Math.min(lines.length, Math.ceil((scrollTop + (containerRef.current?.clientHeight ?? 600)) / lineHeight) + VISIBLE_BUFFER);
    return lines.slice(start, end + 1);
  }, [lines, scrollTop]);
  const visibleOffset = useMemo(
    () => Math.max(0, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER) * lineHeight,
    [scrollTop]
  );

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  const isSearchActive = searchQuery.trim().length > 0;

  if (!currentDocument || currentDocument.fileData === undefined) return null;

  return (
    <RendererShell
      title={currentDocument.fileName ?? "Code"}
      subtitle="Source preview"
      fileType={currentDocument.fileType}
      icon={<CodeRoundedIcon />}
      headerMode="none"
      contentSx={{ p: 0 }}
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {searchBar}

        {isLarge && !showHighlight ? (
          <>
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
            <Box
              ref={containerRef}
              onScroll={handleScroll}
              component="pre"
              sx={{
                m: 0, p: 2.5, flex: 1, overflow: "auto",
                fontFamily: "Consolas, Monaco, 'Andale Mono', monospace",
                fontSize: 13, lineHeight: `${lineHeight}px`,
                whiteSpace: "pre", wordWrap: "normal",
              }}
            >
              <Box sx={{ height: totalHeight, position: "relative" }}>
                <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${visibleOffset}px)` }}>
                  {visibleLines.map((line, i) => {
                    const lineNum = Math.max(1, Math.floor(scrollTop / lineHeight) - VISIBLE_BUFFER + i + 1);
                    const lineContent = line;
                    let content: React.ReactNode = lineContent;

                    // search highlight for virtual scroll mode
                    if (isSearchActive) {
                      const q = searchQuery.toLowerCase();
                      const lower = lineContent.toLowerCase();
                      const parts: React.ReactNode[] = [];
                      let pos = 0;
                      while (true) {
                        const idx = lower.indexOf(q, pos);
                        if (idx === -1) break;
                        if (idx > pos) parts.push(<span key={`t-${pos}`}>{lineContent.slice(pos, idx)}</span>);
                        parts.push(
                          <mark
                            key={`m-${idx}`}
                            style={{
                              backgroundColor: alpha("#f59e0b", 0.28),
                              color: "inherit", borderRadius: 2, padding: "0 1px",
                            }}
                          >
                            {lineContent.slice(idx, idx + searchQuery.length)}
                          </mark>
                        );
                        pos = idx + searchQuery.length;
                      }
                      if (pos < lineContent.length) parts.push(<span key={`t-${pos}`}>{lineContent.slice(pos)}</span>);
                      if (parts.length > 0) content = parts;
                    }

                    return (
                      <Box key={i} sx={{ display: "flex" }}>
                        <Typography component="span" variant="caption"
                          sx={{ minWidth: 48, textAlign: "right", pr: 1.5, color: "text.disabled", userSelect: "none", fontFamily: "inherit", fontSize: "inherit" }}
                        >
                          {lineNum}
                        </Typography>
                        <Typography component="code" variant="body2"
                          sx={{ fontFamily: "inherit", whiteSpace: "pre" }}
                        >
                          {content}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          </>
        ) : (
          <Box ref={syntaxRef} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <SyntaxHighlighter
              language={currentDocument.fileType}
              style={theme.palette.mode === "dark" ? oneDark : coy}
              showLineNumbers
              customStyle={{
                margin: 0,
                minHeight: "100%",
                borderRadius: 16,
                padding: "20px",
                background: "transparent",
              }}
            >
              {data}
            </SyntaxHighlighter>
          </Box>
        )}
      </Box>
    </RendererShell>
  );
}

CodeRenderer.fileTypes = CODE_LIKE_EXTENSIONS;
CodeRenderer.weight = 1;
