export type Course = {
    id: number,
    uuid: string,
    name: string,
    course_code: string,
}

export type File = {
    key: string,
    id: number,
    uuid: string,
    folder_id: number,
    url: string,
    display_name: string,
    filename: string,
    size: number,
}

export type FileDownloadTask = {
    key: string,
    file: File
    progress: number,
}

export type AppConfig = {
    token: string,
}

export type ProgressPayload = {
    uuid: string,
    downloaded: number,
    total: number,
}