export interface Course {
    id: number,
    uuid: string,
    name: string,
    course_code: string,
}

export interface File {
    key: string,
    id: number,
    uuid: string,
    folder_id: number,
    url: string,
    display_name: string,
    locked: boolean,
    filename: string,
    size: number,
}

export interface Folder {
    id: number;
    name: string;
    full_name: string;
    parent_folder_id?: number | null;
    locked: boolean;
    folders_url: string;
    files_url: string;
    files_count: number;
    folders_count: number;
}

export interface FileDownloadTask {
    key: string,
    file: File
    progress: number,
}

export interface AppConfig {
    token: string,
    save_path: string,
}

export interface ProgressPayload {
    uuid: string,
    downloaded: number,
    total: number,
}