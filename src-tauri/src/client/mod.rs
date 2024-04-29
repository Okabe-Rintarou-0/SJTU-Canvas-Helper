use reqwest::cookie::Jar;
use std::sync::Arc;

pub mod basic;
mod common;
mod constants;
pub mod jbox;
pub mod video;

pub struct Client {
    cli: reqwest::Client,
    jar: Arc<Jar>,
}

#[cfg(test)]
mod test {
    use crate::{
        client::Client,
        error::Result,
        model::{Course, EnrollmentRole},
    };
    use std::collections::HashMap;

    fn os_env_hashmap() -> HashMap<String, String> {
        let mut map = HashMap::new();
        use std::env;
        for (key, val) in env::vars_os() {
            // Use pattern bindings instead of testing .is_some() followed by .unwrap()
            if let (Ok(k), Ok(v)) = (key.into_string(), val.into_string()) {
                map.insert(k, v);
            }
        }
        map
    }

    fn get_token_from_env() -> String {
        let env_vars = os_env_hashmap();
        env_vars.get("CANVAS_TOKEN").cloned().unwrap_or_default()
    }

    fn check_rfc3339_time_format(time: &Option<String>) -> bool {
        if let Some(time) = time {
            chrono::DateTime::parse_from_rfc3339(time).is_ok()
        } else {
            true
        }
    }

    fn is_ta(course: &Course) -> bool {
        let filtered: Vec<_> = course
            .enrollments
            .iter()
            .filter(|enrollment| enrollment.role == EnrollmentRole::TaEnrollment)
            .collect();
        !filtered.is_empty()
    }

    #[tokio::test]
    async fn test_get_uuid() -> Result<()> {
        let cli = Client::new();
        let uuid = cli.get_uuid().await?;
        assert!(uuid.is_some());
        let uuid: String = uuid.unwrap();
        assert!(!uuid.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn test_get_me() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::new();
        let me = cli.get_me(&token).await?;
        assert!(me.id > 0);
        assert!(!me.name.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn test_list_courses() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::new();

        let courses = cli.list_courses(&token).await?;
        assert!(!courses.is_empty());
        for course in courses {
            assert!(course.id > 0);
            assert!(course.term.id > 0);
            assert!(!course.teachers.is_empty());
            assert!(!course.uuid.is_empty());
            assert!(!course.enrollments.is_empty());
            assert!(check_rfc3339_time_format(&course.term.created_at));
            assert!(check_rfc3339_time_format(&course.term.start_at));
            assert!(check_rfc3339_time_format(&course.term.end_at));
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_list_assignments() -> Result<()> {
        tracing_subscriber::fmt::init();
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::new();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let assignments = cli.list_course_assignments(course.id, &token).await?;
            for assignment in assignments {
                assert_eq!(assignment.course_id, course.id);
                assert!(assignment.id > 0);
                assert!(check_rfc3339_time_format(&assignment.due_at));
                assert!(check_rfc3339_time_format(&assignment.lock_at));
                for assignment_override in assignment.overrides {
                    assert!(check_rfc3339_time_format(&assignment_override.unlock_at));
                    assert!(check_rfc3339_time_format(&assignment_override.lock_at));
                    assert!(check_rfc3339_time_format(&assignment_override.due_at));
                    assert!(!assignment_override.student_ids.is_empty());
                }
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_list_users() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::new();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let term = &course.term;
            let Some(end_at) = &term.end_at else {
                continue;
            };
            let is_ta = is_ta(&course);
            let end_at = chrono::DateTime::parse_from_rfc3339(end_at);
            assert!(end_at.is_ok());
            let end_at = end_at.unwrap().naive_local();
            let now = chrono::offset::Local::now().naive_local();

            if now > end_at && !is_ta {
                assert!(cli.list_course_users(course.id, &token).await.is_err());
                continue;
            }
            let users = cli.list_course_users(course.id, &token).await?;

            assert!(!users.is_empty());

            for user in users {
                assert!(user.id > 0);
                assert!(!user.name.is_empty());
                if is_ta {
                    assert!(!user.email.is_empty());
                }
            }
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_list_submissions() -> Result<()> {
        let token = get_token_from_env();
        assert!(!token.is_empty());
        let cli = Client::new();
        let courses = cli.list_courses(&token).await?;
        for course in courses {
            let is_ta = is_ta(&course);
            if !is_ta {
                continue;
            }

            let assignments = cli.list_course_assignments(course.id, &token).await?;
            for assignment in assignments {
                let submissions = cli
                    .list_course_assignment_submissions(course.id, assignment.id, &token)
                    .await?;
                for submission in submissions {
                    assert_eq!(submission.assignment_id, assignment.id);
                    assert!(submission.id > 0);
                    assert!(check_rfc3339_time_format(&submission.submitted_at));
                }
            }
        }
        Ok(())
    }
}
