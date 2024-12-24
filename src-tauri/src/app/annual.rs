use super::App;
use crate::{error::Result, model::AnnualReport};

impl App {
    pub async fn generate_annual_report(&self, year: i32) -> Result<AnnualReport> {
        let token = self.config.read().await.token.clone();
        self.client.generate_annual_report(&token, year).await
    }
}
