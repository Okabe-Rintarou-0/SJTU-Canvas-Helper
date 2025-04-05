export const LOG_LEVEL_DEBUG = 0;
export const LOG_LEVEL_INFO = 1;
export const LOG_LEVEL_WARN = 2;
export const LOG_LEVEL_ERROR = 3;

export type LogLevel = number;

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
    end_at?: string | null;
    created_at?: string | null;
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

export interface RelationshipNode {
    id: string;
    label: string;
    nodeType: "Default" | "Me" | "Course"
}

export interface RelationshipEdge {
    source: string;
    target: string;
}

export interface RelationshipTopo {
    nodes: RelationshipNode[];
    edges: RelationshipEdge[];
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
    key: string;
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

export type Entry = File | Folder;
export function isFile(entry: Entry) {
    return 'display_name' in entry;
}
export function entryName(entry: Entry) {
    if (isFile((entry))) {
        return (entry as File).display_name;
    }
    else {
        return (entry as Folder).name;
    }
}

export interface User {
    id: number;
    key: number;
    name: string;
    created_at: string;
    sortable_name: string;
    short_name: string;
    login_id: string;
    email: string | null;
}

export interface UserSubmissions {
    user_id: number;
    username?: string;
    submissions: Submission[]
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
    end_at?: string | null;
    start_at?: string | null;
    context_code: string;
    context_name: string;
    url: string;
    important_dates: boolean;
}

export interface Assignment {
    id: number;
    key: number;
    needs_grading_count: number | null;
    description: string | null;
    due_at?: string | null;
    unlock_at?: string;
    lock_at?: string;
    points_possible?: number;
    course_id: number;
    name: string;
    html_url: string;
    submission_types: string[];
    allowed_extensions: string[];
    published: boolean;
    has_submitted_submissions: boolean;
    submission?: Submission;
    overrides: AssignmentOverride[];
    all_dates: AssignmentDate[];
    score_statistics: ScoreStatistic | null
}

export interface AssignmentDate {
    id: number;
    base: boolean;
    title: string;
    due_at: string | null;
    unlock_at: string | null;
    lock_at: string | null;
}

export interface AssignmentOverride {
    id: number;
    pub_id: number;
    assignment_id: number;
    quiz_id: number;
    context_module_id: number;
    student_ids: number[];
    group_id: number;
    course_section_id: number;
    title: string;
    due_at: string | null;
    all_day: boolean;
    all_day_date: string;
    unlock_at: string | null;
    lock_at: string | null;
}

export type WorkflowState = "submitted" | "unsubmitted" | "graded" | "pending_review";

export interface Submission {
    id: number;
    key: number;
    grade: string | null;
    submitted_at?: string;
    assignment_id: number;
    user_id: number;
    late: boolean;
    attachments: Attachment[];
    submission_comments: SubmissionComment[];
    workflow_state: WorkflowState;
}

export interface GradeStatistic {
    grades: number[];
    total: number;
}

export interface ScoreStatistic {
    min: number;
    max: number;
    mean: number;
}

export interface Attachment {
    user?: string;
    user_id: number;
    submitted_at?: string;
    grade: string | null;
    id: number;
    key: React.Key;
    late: boolean;
    comments: SubmissionComment[];
    uuid: string;
    folder_id: number | null;
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

export interface DownloadTask {
    key: string;
    name: string;
    progress: number;
    state: "downloading" | "completed" | "fail" | "merging";
}

export type DownloadState = "downloading" | "succeed" | "fail" | "wait_retry";

export interface AppConfig {
    token: string;
    account_type: "Default" | "JI";
    save_path: string;
    serve_as_plaintext: string;
    ja_auth_cookie: string;
    video_cookies: string;
    proxy_port: number;
    course_assignment_file_bindings: Record<number, File[]>;
    show_alert_map: Record<string, boolean>;
}

export interface AccountInfo {
    current_account: string;
    all_accounts: string[];
}

export interface ExportUsersConfig {
    save_name: string;
}

export interface ProgressPayload {
    uuid: string;
    processed: number;
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

export interface CanvasVideo {
    videoId: string;
    userName: string;
    videoName: string;
    classroomName: string;
    courseBeginTime: string,
    courseEndTime: string,
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

export interface MediaComment {
    content_type: string;
    display_name: string;
    media_id: string;
    media_type: string;
    url: string;
}

export interface SubmissionComment {
    id: number;
    comment: string;
    author_id: number;
    author_name: string;
    created_at: string;
    avatar_path: string;
    media_comment?: MediaComment | null;
    attachments: Attachment[]
}

export interface GradeStatus {
    assignmetName: string;
    maxGrade: number;
    actualGrade: number;
}

export interface QRCodeScanResult {
    file: File,
    contents: string[];
}

export interface DiscussionTopic {
    id: number;
    title: string;
    last_reply_at: string | null;
    created_at: string | null;
    delayed_post_at: string | null;
    posted_at: string | null;
    user_name: string | null;
    lock_at: string | null;
    assignment_id: number | null;
    podcast_has_student_posts: boolean | null;
    discussion_type: string;
    allow_rating: boolean | null;
    only_graders_can_rate: boolean | null;
    sort_by_rating: boolean | null;
    is_section_specific: boolean | null;
    discussion_subentry_count: number;
    permissions: Permissions;
    require_initial_post: boolean | null;
    user_can_see_posts: boolean | null;
    podcast_url: string | null;
    read_state: string;
    unread_count: number;
    subscribed: boolean | null;
    attachments: Attachment[];
    published: boolean | null;
    can_unpublish: boolean | null;
    locked: boolean | null;
    can_lock: boolean | null;
    comments_disabled: boolean | null;
    html_url: string;
    url: string;
    pinned: boolean | null;
    can_group: boolean | null;
    locked_for_user: boolean | null;
    lock_explanation: string;
    message: string;
    assignment: Assignment | null;
}

export interface Permissions {
    attach: boolean;
    update: boolean;
    reply: boolean;
    delete: boolean;
}

export interface FullDiscussion {
    unread_entries: number[];
    new_entries: number[];
    participants: Participant[];
    view: DiscussionView[];
}

export interface Participant {
    id: number;
    anonymous_id: string;
    display_name: string;
    avatar_image_url: string;
    html_url: string;
}

export interface DiscussionView {
    id: number;
    parent_id: number | null;
    created_at: string | null;
    updated_at: string | null;
    editor_id: number | null;
    rating_count: number | null;
    rating_sum: number | null;
    deleted: boolean | null;
    user_id: number | null;
    message: string | null;
    replies: Reply[];
}

export interface Reply {
    id: number;
    user_id: number;
    parent_id: number;
    created_at: string | null;
    updated_at: string | null;
    rating_count: number | null;
    rating_sum: number | null;
    message: string | null;
}

export interface DraggableItem {
    id: string;
    content: string;
    data: any;
}

export interface VideoAggregateParams {
    mainVideoPath: string;
    subVideoPath: string;
    outputDir: string;
    outputName: string;
    // 0% ~ 100%, 100% by default
    subVideoAlpha: number;
    // 0% ~ 50%, 25% by default
    subVideoSizePercentage: number;
}

export interface AnnualCourseStatistic {
    courseId: number;
    courseName: string;
    submitTimeList: string[];
}

export interface AnnualReport {
    year: number;
    courseToStatistic: Record<number, AnnualCourseStatistic>;
}