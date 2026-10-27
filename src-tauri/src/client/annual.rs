use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike};

use super::Client;
use crate::{
    error::Result,
    model::{AnnualCourseStatistic, AnnualReport, Course},
};

impl Client {
    async fn list_all_courses_of_year(&self, token: &str, year: i32) -> Result<Vec<Course>> {
        let mut courses = self.list_courses(token).await?;
        courses.retain(|c| match c.term.start_at.clone() {
            None => false,
            Some(start_at) => {
                let parsed = DateTime::parse_from_rfc3339(&start_at);
                if parsed.is_err() {
                    return false;
                }
                let start_at = parsed.unwrap();
                start_at.year() == year
            }
        });
        Ok(courses)
    }

    pub async fn generate_annual_report(&self, token: &str, year: i32) -> Result<AnnualReport> {
        let courses = self.list_all_courses_of_year(token, year).await?;
        let mut course_to_statistic = HashMap::new();
        let mut active_days = HashSet::new();
        let mut first_submit_at: Option<String> = None;
        let mut last_submit_at: Option<String> = None;
        for course in courses {
            let assignments = self.list_course_assignments(course.id, token).await?;
            let mut submit_time_list = vec![];
            let mut assignment_count = 0;
            let mut submitted_count = 0;
            let mut late_count = 0;
            let mut graded_count = 0;
            let mut total_points_possible = 0.0;
            let mut total_score = 0.0;
            for assignment in assignments {
                assignment_count += 1;
                total_points_possible += assignment.points_possible.unwrap_or_default();
                if let Some(submission) = assignment.submission {
                    if let Some(submitted_at) = submission.submitted_at {
                        active_days.insert(submitted_at.chars().take(10).collect::<String>());
                        if first_submit_at
                            .as_ref()
                            .is_none_or(|current| submitted_at < *current)
                        {
                            first_submit_at = Some(submitted_at.clone());
                        }
                        if last_submit_at
                            .as_ref()
                            .is_none_or(|current| submitted_at > *current)
                        {
                            last_submit_at = Some(submitted_at.clone());
                        }
                        submit_time_list.push(submitted_at);
                    }
                    submitted_count += 1;
                    if submission.late {
                        late_count += 1;
                    }
                    if let Some(grade) = submission.grade {
                        if let Ok(score) = grade.parse::<f64>() {
                            total_score += score;
                            graded_count += 1;
                        }
                    }
                }
            }
            course_to_statistic.insert(
                course.id,
                AnnualCourseStatistic {
                    course_id: course.id,
                    course_name: course.name,
                    assignment_count,
                    submitted_count,
                    late_count,
                    graded_count,
                    total_points_possible,
                    total_score,
                    submit_time_list,
                },
            );
        }
        Ok(AnnualReport {
            year,
            active_day_count: active_days.len() as i32,
            first_submit_at,
            last_submit_at,
            course_to_statistic,
        })
    }
}
