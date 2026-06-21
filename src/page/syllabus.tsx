import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Typography,
} from "@mui/material";
import { useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { useCourseSyllabus, useCourses } from "../lib/hooks";

export default function SyllabusPage() {
  const [selectedCourseId, setSelectedCourseId] = useState(-1);
  const { data: courses } = useCourses();
  const { data: syllabusCourse, isLoading } = useCourseSyllabus(selectedCourseId);

  return (
    <BasicLayout>
      <Card sx={{ borderRadius: "24px", boxShadow: "none", border: "1px solid", borderColor: "divider" }}>
        <CardContent sx={{ p: 3 }}>
          <CourseSelect
            courses={courses}
            value={selectedCourseId}
            onChange={setSelectedCourseId}
          />
        </CardContent>
      </Card>

      {selectedCourseId <= 0 ? (
        <Card sx={{ mt: 2, borderRadius: "24px", boxShadow: "none", border: "1px solid", borderColor: "divider" }}>
          <CardContent sx={{ p: 4, display: "grid", placeItems: "center", minHeight: 200 }}>
            <Box sx={{ textAlign: "center" }}>
              <AutoStoriesRoundedIcon sx={{ fontSize: 48, color: "text.secondary", mb: 1 }} />
              <Typography variant="h6" color="text.secondary">
                请先选择课程
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Box sx={{ mt: 2, display: "grid", placeItems: "center", minHeight: 200 }}>
          <CircularProgress />
        </Box>
      ) : syllabusCourse?.syllabus_body ? (
        <Card sx={{ mt: 2, borderRadius: "24px", boxShadow: "none", border: "1px solid", borderColor: "divider" }}>
          <CardContent
            sx={{ p: 3 }}
            dangerouslySetInnerHTML={{ __html: syllabusCourse.syllabus_body }}
          />
        </Card>
      ) : (
        <Card sx={{ mt: 2, borderRadius: "24px", boxShadow: "none", border: "1px solid", borderColor: "divider" }}>
          <CardContent sx={{ p: 4, display: "grid", placeItems: "center", minHeight: 200 }}>
            <Typography color="text.secondary">该课程暂无教学大纲</Typography>
          </CardContent>
        </Card>
      )}
    </BasicLayout>
  );
}
