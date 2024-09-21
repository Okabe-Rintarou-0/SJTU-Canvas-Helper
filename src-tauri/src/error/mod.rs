use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Json deserialization error: {0}\n Raw data: {1}")]
    JsonDeserialize(serde_json::Error, String),
    #[error("Json parse error: {0}")]
    JsonParse(#[from] serde_json::Error),
    #[error("I/O error: {0}")]
    IO(#[from] io::Error),
    #[error("Excel error: {0}")]
    Excel(#[from] xlsxwriter::XlsxError),
    #[error("Base64 decode error: {0}")]
    Base64Decode(#[from] base64::DecodeError),
    #[error("To string error: {0}")]
    ToStrError(#[from] reqwest::header::ToStrError),
    #[error("Login error")]
    LoginError,
    #[error("JBox error: {0}")]
    JBoxError(String),
    #[error("Function unsupported")]
    #[allow(dead_code)]
    FunctionUnsupported,
    #[error("Submission upload error: {0}")]
    SubmissionUpload(String),
    #[error("Join error: {0}")]
    JoinError(#[from] tokio::task::JoinError),
    #[error("QRCode Image error: {0}")]
    QRCodeImage(#[from] image::ImageError),
    #[error("Account already exists")]
    AccountAlreadyExists,
    #[error("Account not exists")]
    AccountNotExists,
    #[error("Not allowed to delete default account")]
    NotAllowedToDeleteDefaultAccount,
    #[error("Not allowed to create default account")]
    NotAllowedToCreateDefaultAccount,
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
