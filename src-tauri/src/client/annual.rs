use std::collections::HashMap;

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
        for course in courses {
            let assignments = self.list_course_assignments(course.id, token).await?;
            let mut submit_time_list = vec![];
            for assignment in assignments {
                if let Some(submission) = assignment.submission {
                    if let Some(submitted_at) = submission.submitted_at {
                        submit_time_list.push(submitted_at);
                    }
                }
            }
            course_to_statistic.insert(
                course.id,
                AnnualCourseStatistic {
                    course_id: course.id,
                    course_name: course.name,
                    submit_time_list,
                },
            );
        }
        Ok(AnnualReport {
            year,
            course_to_statistic,
        })
    }
}
