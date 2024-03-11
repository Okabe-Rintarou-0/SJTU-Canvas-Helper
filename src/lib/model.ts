export interface Course {
    id: number;
    uuid: string;
    name: string;
    course_code: string;
    enrollments: Enrollment[];
    teachers: Teacher[];
    term: Term;
}

interface Term {
    id: number;
    name: string;
    start_at?: string | null;
    end_at: string;
    created_at: string;
    workflow_state: string;
}

export type EnrollmentRole = "TaEnrollment" | "StudentEnrollment" | "TeacherEnrollment" | "DesignerEnrollment" | "ObserverEnrollment";

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

export interface Colors {
    custom_colors: { [key: string]: string };
}

export interface CalendarEvent {
    title: string;
    workflow_state: string;
    id: string;
    type_field: string;
    assignment: Assignment;
    html_url: string;
    end_at: string;
    start_at: string;
    context_code: string;
    context_name: string;
    url: string;
    important_dates: boolean;
}

export interface Assignment {
    id: number;
    key: number;
    needs_grading_count: number | null;
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
    grade: string | null;
    submitted_at?: string;
    assignment_id: number;
    user_id: number;
    late: boolean;
    attachments: Attachment[];
    workflow_state: WorkflowState;
}

export interface GradeStatistic {
    grades: number[];
    total: number;
}

export interface Attachment {
    user?: string;
    user_id: number;
    submitted_at?: string;
    grade: string | null;
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
    file: File;
    progress: number;
    state: DownloadState;
}

export interface VideoDownloadTask {
    key: string;
    video: VideoPlayInfo;
    progress: number;
    state: DownloadState;
}

export type DownloadState = "downloading" | "succeed" | "fail";

export interface AppConfig {
    token: string;
    save_path: string;
    serve_as_plaintext: string;
    ja_auth_cookie: string;
    video_cookies: string;
    proxy_port: number;
}

export interface ExportUsersConfig {
    save_name: string;
}

export interface ProgressPayload {
    uuid: string;
    downloaded: number;
    total: number;
}

export interface Payload {
    sig: string;
    ts: number;
}

export interface LoginMessage {
    error: number;
    payload: Payload;
    type: string;
}

export interface Subject {
    subjectId: number;
    csplId: number;
    subjectName: string;
    classroomId: number;
    classroomName: string;
    userId: number;
    userName: string;
    courTimes: number;
    subjImgUrl: string;
    teclId: number;
    teclName: string;
    termTime: number;
    beginYear: number;
    endYear: number;
}

export interface VideoCourse {
    videPlayCount: number;
    videCommentAverage: number;
    videPalyTime: number;
    videPalyTimes: number;
    videImgUrl: string;
    subjName: string;
    subjId: number;
    courId: number;
    responseVoList: Video[];
    courTimes: number;
    subjImgUrl: string;
    teclId: number;
    teclName: string;
    indexCount: number;
    csplId: number;
    tetiBeginYear: number;
    tetiEndYear: number;
    tetiTerm: number;
}

export interface Video {
    id: number;
    userName: string;
    userId: number;
    videName: string;
    videPlayCount: number;
    videCommentAverage: number;
    videPalyTime: number;
    videPalyTimes: number;
    videSource: number;
    subjId: number;
    courId: number;
    courBeginTime: number;
    courEndTime: number;
    courTimes: number;
    indexCount: number;
    csplId: number;
    videId: number;
}

export interface VideoPlayInfo {
    name: string;
    key: number;
    id: number;
    index: number;
    videPlayTime: number;
    clientIpType: number;
    rtmpUrlHdv: string;
    cdviChannelNum: number;
    cdviViewNum: number;
}

export interface VideoInfo {
    id: number;
    courId: number;
    videSource: number;
    smseId: number;
    videVodId: number;
    cminId: number;
    deviPuid: string;
    videRecordChannelNum: number;
    videBeginTime: string;
    videEndTime: string;
    videPlayTime: number;
    videName: string;
    videPlayCount: number;
    videCommentCount: number;
    videCommentAverage: number;
    courTimes: number;
    courName: string;
    organizationName: string;
    subjId: number;
    clroId: number;
    clroName: string;
    userId: number;
    userName: string;
    subjName: string;
    teclName: string;
    teclId: number;
    rtmpUrlHdv: string;
    userAvatar: string;
    loginUserId: number;
    videBeginTimeMs: number;
    videEndTimeMs: number;
    videoPlayResponseVoList: VideoPlayInfo[];
}

export interface Teacher {
    id: number;
    anonymous_id: string;
    display_name: string;
    avatar_image_url: string;
    html_url: string;
}

