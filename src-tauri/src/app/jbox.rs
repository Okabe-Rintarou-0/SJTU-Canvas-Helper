use super::App;
use crate::{
    error::Result,
    model::{File, ProgressPayload},
};
// Apis for jbox
impl App {
    pub async fn login_jbox(&self) -> Result<()> {
        let cookie = self.get_cookie().await;
        let user_token = self.client.login_jbox(&cookie).await?;
        let info = self.client.get_user_space_info(&user_token).await?.into();
        let mut config = self.get_config().await;
        config.jbox_login_info = info;
        self.save_config(config).await?;
        Ok(())
    }

    pub async fn upload_file<F: Fn(ProgressPayload) + Send>(
        &self,
        file: &File,
        save_dir: &str,
        progress_handler: F,
    ) -> Result<()> {
        let config = self.get_config().await;
        let info = config.jbox_login_info;
        self.client
            .upload_file(file, save_dir, &info, progress_handler)
            .await
    }
}
