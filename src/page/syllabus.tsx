import AutoStoriesRoundedIcon from "@mui/icons-material/AutoStoriesRounded";
import {
  Box,
  Card,
  CardContent,
  Typography,
} from "@mui/material";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import { ListSkeleton } from "../components/skeleton";
import { useCourseSyllabus, useCourses, useSelectedCourse } from "../lib/hooks";

export default function SyllabusPage() {
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const { data: courses } = useCourses();
  const syllabusCourseId = selectedCourseId > 0 ? selectedCourseId : undefined;
  const { data: syllabusCourse, isLoading } = useCourseSyllabus(syllabusCourseId);

  return (
    <BasicLayout>
      <Box sx={{ minHeight: "100%", color: "text.primary" }}>
        <WorkspaceHero
          chipLabel="教学大纲"
          chipIcon={<AutoStoriesRoundedIcon />}
          title="教学大纲"
          description="查看课程发布的 HTML 教学大纲，了解考核方式与授课安排。"
          aside={
            <Box
              sx={{
                width: { xs: "100%", lg: 680 },
                alignSelf: { xs: "stretch", lg: "flex-start" },
              }}
            >
              <CourseSelect
                courses={courses}
                value={syllabusCourseId}
                onChange={setSelectedCourseId}
              />
            </Box>
          }
        />

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
          <Box sx={{ mt: 2 }}>
            <ListSkeleton items={2} />
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
      </Box>
    </BasicLayout>
  );
}
