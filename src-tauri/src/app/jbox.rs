use super::{App, ConfigSnapshot};
use crate::{
    error::{AppError, Result},
    model::{File, ProgressPayload},
};

impl App {
    async fn upload_config_snapshot(&self, expected_owner: &str) -> Result<ConfigSnapshot> {
        let snapshot = self.get_config_snapshot().await?;
        if snapshot.owner != expected_owner { return Err(AppError::StaleConfigOwner); }
        Ok(snapshot)
    }

    pub async fn login_jbox(&self, expected_owner: &str) -> Result<ConfigSnapshot> {
        let snapshot = self.upload_config_snapshot(expected_owner).await?;
        let cookie = format!("JAAuthCookie={}", snapshot.config.ja_auth_cookie);
        let client = crate::client::Client::jbox_client_for_cookie(&cookie)?;
        let login_result = self.client.login_jbox_with_client(&client).await;
        self.ensure_config_owner(expected_owner).await?;
        let user_token = login_result?;
        let info_result = self.client.get_user_space_info_with_client(&user_token, &client).await;
        self.ensure_config_owner(expected_owner).await?;
        self.commit_jbox_login(expected_owner, info_result?.into()).await
    }

    pub async fn upload_file<F: Fn(ProgressPayload) + Send>(
        &self, file: &File, save_dir: &str, expected_owner: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.upload_config_snapshot(expected_owner).await?;
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        let directory = tempfile::Builder::new().prefix("canvas-upload-").tempdir()?;
        let mut source = file.clone();
        source.display_name = "source.bin".to_owned();
        let downloaded = client.download_file(&source, &snapshot.config.token, directory.path(), |_| {}).await;
        self.ensure_config_owner(expected_owner).await?;
        downloaded?;
        let bytes = std::fs::read(directory.path().join("source.bin"))?;
        let result = client.upload_content(&bytes, &file.display_name, &file.uuid, save_dir,
            &snapshot.config.jbox_login_info, progress_handler).await;
        self.ensure_config_owner(expected_owner).await?;
        result
    }

    pub async fn upload_file_as_pdf<F: Fn(ProgressPayload) + Send>(
        &self, file: &File, save_dir: &str, expected_owner: &str, progress_handler: F,
    ) -> Result<()> {
        let snapshot = self.upload_config_snapshot(expected_owner).await?;
        let client = self.client.canvas_read_snapshot(Self::get_base_url(&snapshot.config.account_type));
        let converted = self.convert_office_file_to_pdf_with_client(file, &client, &snapshot.config.token).await;
        self.ensure_config_owner(expected_owner).await?;
        let (name, bytes) = converted?;
        let result = client.upload_content(&bytes, &name, &file.uuid, save_dir,
            &snapshot.config.jbox_login_info, progress_handler).await;
        self.ensure_config_owner(expected_owner).await?;
        result
    }
}
