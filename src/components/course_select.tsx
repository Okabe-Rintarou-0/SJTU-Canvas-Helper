import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import {
  Autocomplete,
  Box,
  Chip,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { useMemo } from "react";

import { Course } from "../lib/model";

export default function CourseSelect({
  courses,
  disabled,
  onChange,
  value,
}: {
  courses: Course[];
  disabled?: boolean;
  onChange?: (courseId: number) => void;
  value?: number;
}) {
  const formatCourseName = (course: Course): string => {
    const term = course.term.name.replace("Spring", "春").replace("Fall", "秋");
    const teacherNames =
      course.teachers
        ?.filter((teacher) => teacher?.display_name)
        .map((teacher) => teacher.display_name)
        .slice(0, 2) || [];

    const teacherText = teacherNames.length > 0 ? teacherNames.join("、") : "未知教师";
    return `${course.name} | ${term} | ${teacherText}`;
  };

  const formattedCourses = useMemo(() => {
    return [...courses]
      .map((course) => ({
        ...course,
        name: formatCourseName(course),
      }))
      .sort((a, b) => b.term.id - a.term.id);
  }, [courses]);

  const selectedCourse =
    formattedCourses.find((course) => course.id === value) ?? null;

  const hasCourses = courses.length > 0;
  const theme = useTheme();

  return (
    <Autocomplete
      fullWidth
      disabled={disabled || !hasCourses}
      options={formattedCourses}
      value={selectedCourse}
      onChange={(_, nextValue) => onChange?.(nextValue?.id ?? -1)}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, currentValue) => option.id === currentValue.id}
      noOptionsText="暂无可用课程"
      PaperComponent={(props) => (
        <Paper
          {...props}
          sx={{
            mt: 1,
            borderRadius: "14px",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.1)",
            overflow: "hidden",
          }}
        />
      )}
      renderOption={(props, option) => {
        const isTA = option.enrollments?.some(
          (enrollment) => enrollment.role === "TaEnrollment"
        );
        const teacherNames =
          option.teachers
            ?.filter((teacher) => teacher?.display_name)
            .map((teacher) => teacher.display_name)
            .slice(0, 2)
            .join("、") || "未知教师";
        const term = option.term.name.replace("Spring", "春").replace("Fall", "秋");

        return (
          <Box
            component="li"
            {...props}
            sx={{
              px: 2,
              py: 1.35,
              alignItems: "stretch",
            }}
          >
            <Box sx={{ minWidth: 0, width: "100%" }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  flexWrap: "wrap",
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700, wordBreak: "break-word" }}
                >
                  {option.name.split(" | ")[0]}
                </Typography>
                {isTA ? <Chip size="small" color="error" label="助教" /> : null}
              </Box>
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  flexWrap: "wrap",
                  mt: 0.65,
                }}
              >
                <Chip
                  size="small"
                  label={term}
                  variant="outlined"
                  sx={{ borderRadius: "10px" }}
                />
                <Chip
                  size="small"
                  label={teacherNames}
                  variant="outlined"
                  sx={{ borderRadius: "10px", maxWidth: "100%" }}
                />
              </Box>
            </Box>
          </Box>
        );
      }}
      filterOptions={(options, state) => {
        const keyword = state.inputValue.trim().toLowerCase();
        if (!keyword) {
          return options;
        }

        return options.filter((course) => {
          const nameMatch = course.name.toLowerCase().includes(keyword);
          const termMatch = course.term.name.toLowerCase().includes(keyword);
          const teacherMatch =
            course.teachers?.some((teacher) =>
              teacher?.display_name?.toLowerCase().includes(keyword)
            ) || false;

          return nameMatch || termMatch || teacherMatch;
        });
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={hasCourses ? "请选择或搜索课程…" : "暂无可用课程"}
          helperText={
            selectedCourse
              ? `当前已选：${selectedCourse.name.split(" | ")[0]}`
              : "优先展示最近学期课程，支持按课程、学期和教师搜索。"
          }
          sx={{
            "& .MuiOutlinedInput-root": {
              minHeight: 56,
              borderRadius: "14px",
              bgcolor: alpha(theme.palette.background.paper, 0.72),
            },
          }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                <InputAdornment position="start">
                  <SchoolRoundedIcon color="action" />
                </InputAdornment>
                {params.InputProps.startAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
