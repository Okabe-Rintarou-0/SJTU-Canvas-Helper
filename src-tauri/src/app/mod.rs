use cache::Cache;
use std::sync::Arc;
use tokio::{sync::RwLock, task::JoinHandle};

use crate::{
    client::Client,
    model::{Account, AppConfig},
};
pub mod annual;
pub mod basic;
pub mod cache;
mod constants;
pub mod jbox;
pub mod video;

pub struct App {
    client: Arc<Client>,
    current_account: RwLock<Account>,
    config: RwLock<AppConfig>,
    handle: RwLock<Option<JoinHandle<()>>>,
    cache: Cache,
}

#[cfg(test)]
mod test {
    use crate::{
        error::Result,
        model::{Account, File},
        App,
    };

    #[ignore]
    #[tokio::test]
    async fn test_get_calendar_events() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();

        let colors = app.get_colors().await?;
        assert!(!colors.custom_colors.is_empty());
        let mut context_codes = vec![];
        for (course_code, _) in colors.custom_colors {
            context_codes.push(course_code);
        }
        let start_date = "2024-02-25T16:00:00.000Z";
        let end_date = "2024-03-31T16:00:00.000Z";
        let events = app
            .list_calendar_events(&context_codes, start_date, end_date)
            .await?;
        assert!(!events.is_empty());
        Ok(())
    }

    #[ignore]
    #[tokio::test]
    async fn test_account() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;

        let custom_account = Account::Custom("test".to_owned());
        let default_account = Account::Default;
        let non_existent_account = Account::Custom("Non-Existent".to_owned());
        let mut current_account = App::read_account_info()?;
        assert_eq!(current_account.all_accounts, vec![default_account.clone()]);
        assert_eq!(App::list_accounts()?, current_account.all_accounts);

        // Step 0: try to delete default account, should fail
        assert!(app.delete_account(&default_account).await.is_err());

        // Step 1: create account
        App::create_account(&custom_account)?;
        current_account = App::read_account_info()?;
        assert!(App::account_exists(&custom_account)?);
        assert_eq!(
            current_account.all_accounts,
            vec![default_account.clone(), custom_account.clone()]
        );
        assert_eq!(App::list_accounts()?, current_account.all_accounts);

        // cannot create duplicate accounts
        assert!(App::create_account(&custom_account).is_err());

        // Step 2: switch account
        app.switch_account(&custom_account).await?;
        current_account = App::read_account_info()?;
        assert_eq!(custom_account, current_account.current_account);
        assert_eq!(
            current_account.all_accounts,
            vec![default_account.clone(), custom_account.clone()]
        );
        assert_eq!(App::list_accounts()?, current_account.all_accounts);

        // Step 3 delete account
        app.delete_account(&custom_account).await?;
        current_account = App::read_account_info()?;
        assert!(!App::account_exists(&custom_account)?);
        assert_eq!(current_account.current_account, Default::default());
        assert_eq!(current_account.all_accounts, vec![default_account.clone()]);
        assert_eq!(App::list_accounts()?, current_account.all_accounts);

        // try to delete non-existent account should fail
        assert!(app.delete_account(&non_existent_account).await.is_err());
        Ok(())
    }

    #[ignore]
    #[tokio::test]
    async fn test_filter_course_qrcode() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;
        let course_id = 66427;
        let result = app.filter_course_qrcode_images(course_id).await?;
        tracing::info!("result: {:?}", result);
        Ok(())
    }

    #[ignore]
    #[tokio::test]
    async fn test_video_apis() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;
        app.login_video_website().await?;
        let subjects = app.get_subjects().await?;
        tracing::info!("{:?}", subjects);
        let subject = &subjects[0];
        let course = app
            .get_video_course(subject.subject_id, subject.tecl_id)
            .await?
            .unwrap();
        tracing::info!("{:?}", course);
        let video = app.get_video_info(course.response_vo_list[0].id).await?;
        tracing::info!("video = {:?}", video);

        app.download_video(
            &video.video_play_response_vo_list[0],
            "download.mp4",
            |_| {},
        )
        .await?;
        Ok(())
    }

    #[ignore]
    #[tokio::test]
    async fn test_video_apis_with_canvas() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;
        app.login_canvas_website().await?;
        let courses = app.list_courses().await?;
        let course = courses.last().unwrap();
        tracing::info!("course = {:?}", course.id);
        let videos = app.get_canvas_videos(course.id).await?;
        tracing::info!("videos = {:?}", videos.len());
        let video = videos.first().unwrap();
        let video_info = app.get_canvas_video_info(&video.video_id).await?;
        tracing::info!("canvas video info: {:?}", video_info);
        Ok(())
    }

    #[ignore]
    #[tokio::test]
    async fn test_jbox_apis() -> Result<()> {
        tracing_subscriber::fmt::init();
        let app = App::new();
        app.init().await?;
        app.login_jbox().await?;
        let info = app.get_config().await.jbox_login_info.clone();
        app.client
            .create_jbox_directory("/test/nested", &info)
            .await?;
        let file = File {
            uuid: "9zzeL52Uf5w1wE90GstDBCo21AJMrvQlFg5m86lz".to_owned(),
            url: "https://oc.sjtu.edu.cn/files/8525695/download?download_frd=1".to_owned(),
            display_name: "L2-- 大数据处理的基础设施.pdf".to_owned(),
            ..Default::default()
        };
        app.client
            .upload_file(&file, "/test", &info, |payload| {
                tracing::info!("Processed: {}/{}", payload.processed, payload.total);
            })
            .await?;
        Ok(())
    }
}
