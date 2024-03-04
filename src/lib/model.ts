export interface Course {
    id: number;
    uuid: string;
    name: string;
    course_code: string;
    enrollments: Enrollment[];
}

export type EnrollmentRole = "TaEnrollment" | "StudentEnrollment";

export interface Enrollment {
    type: string;
    role: EnrollmentRole;
    role_id: number;
    user_id: number;
    enrollment_state: string;
}

export interface File {
    key: string;
    id: number;
    uuid: string;
    folder_id: number;
    url: string;
    display_name: string;
    locked: boolean;
    filename: string;
    mime_class: string;
    "content-type": string;
    size: number;
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

export interface User {
    id: number;
    key: number;
    name: string;
    created_at: string;
    sortable_name: string;
    short_name: string;
    login_id: string;
    email: string;
}

export interface Assignment {
    id: number;
    key: number;
    description: string;
    due_at?: string;
    unlock_at?: string;
    lock_at?: string;
    points_possible?: number;
    course_id: number;
    name: string;
    html_url: string;
    allowed_extensions?: string[];
    published: boolean;
    has_submitted_submissions: boolean;
    submission?: Submission;
}

export type WorkflowState = "submitted" | "unsubmitted" | "graded";

export interface Submission {
    id: number;
    key: number;
    submitted_at?: string;
    assignment_id: number;
    user_id: number;
    late: boolean;
    attachments: Attachment[];
    workflow_state: WorkflowState;
}

export interface Attachment {
    user?: string;
    submitted_at?: string;
    id: number;
    key: number;
    late: boolean;
    uuid: string;
    folder_id: number;
    display_name: string;
    filename: string;
    "content-type": string;
    url: string;
    size: number;
    locked: boolean;
    mime_class: string;
    preview_url: string;
}

export interface FileDownloadTask {
    key: string;
    file: File
    progress: number;
    state: FileDownloadState;
}

export type FileDownloadState = "downloading" | "succeed" | "fail";

export interface AppConfig {
    token: string;
    save_path: string;
    serve_as_plaintext: string;
}

export interface ExportUsersConfig {
    save_name: string;
}

export interface ProgressPayload {
    uuid: string;
    downloaded: number;
    total: number;
}