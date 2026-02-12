package com.sjtu.canvas.helper.data.model

import com.google.gson.annotations.SerializedName

data class Course(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("name")
    val name: String?,
    
    @SerializedName("course_code")
    val courseCode: String?,
    
    @SerializedName("start_at")
    val startAt: String?,
    
    @SerializedName("end_at")
    val endAt: String?,
    
    @SerializedName("enrollment_term_id")
    val enrollmentTermId: Long?,
    
    @SerializedName("workflow_state")
    val workflowState: String?,

    @SerializedName("term")
    val term: CourseTerm?,

    @SerializedName("teachers")
    val teachers: List<CourseTeacher>?
)

data class CourseTeacher(
    @SerializedName("display_name")
    val displayName: String?
)

data class CourseTerm(
    @SerializedName("id")
    val id: Long?,

    @SerializedName("name")
    val name: String?,

    @SerializedName("start_at")
    val startAt: String?,

    @SerializedName("end_at")
    val endAt: String?
)

data class CanvasFolder(
    @SerializedName("id")
    val id: Long,

    @SerializedName("name")
    val name: String?,

    @SerializedName("full_name")
    val fullName: String?,

    @SerializedName("parent_folder_id")
    val parentFolderId: Long?
)

data class CanvasCourseFile(
    @SerializedName("id")
    val id: Long,

    @SerializedName("uuid")
    val uuid: String?,

    @SerializedName("display_name")
    val displayName: String,

    @SerializedName("filename")
    val filename: String?,

    @SerializedName("folder_id")
    val folderId: Long?,

    @SerializedName("url")
    val url: String?,

    @SerializedName("size")
    val size: Long?,

    @SerializedName("content-type")
    val contentType: String?,

    @SerializedName("created_at")
    val createdAt: String?,

    @SerializedName("updated_at")
    val updatedAt: String?,

    @SerializedName("modified_at")
    val modifiedAt: String?
)

data class Assignment(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("name")
    val name: String?,
    
    @SerializedName("description")
    val description: String?,
    
    @SerializedName("due_at")
    val dueAt: String?,
    
    @SerializedName("points_possible")
    val pointsPossible: Double?,
    
    @SerializedName("course_id")
    val courseId: Long,
    
    @SerializedName("submission_types")
    val submissionTypes: List<String>?,
    
    @SerializedName("workflow_state")
    val workflowState: String?
)

data class Video(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("title")
    val title: String,
    
    @SerializedName("url")
    val url: String,
    
    @SerializedName("duration")
    val duration: Long?,
    
    @SerializedName("created_at")
    val createdAt: String?
)

data class User(
    @SerializedName("id")
    val id: Long,

    @SerializedName("name")
    val name: String,

    @SerializedName("email")
    val email: String?
)

data class SubmissionUploadPrepareResponse(
    @SerializedName("upload_url")
    val uploadUrl: String?,

    @SerializedName("upload_params")
    val uploadParams: Map<String, String>?,

    @SerializedName("message")
    val message: String?
)

data class UploadedCanvasFile(
    @SerializedName("id")
    val id: Long,

    @SerializedName("display_name")
    val displayName: String?
)

data class CanvasMediaObject(
    @SerializedName("media_id")
    val mediaId: String?,

    @SerializedName("title")
    val title: String?,

    @SerializedName("duration")
    val duration: Long?,

    @SerializedName("created_at")
    val createdAt: String?,

    @SerializedName("media_sources")
    val mediaSources: List<CanvasMediaSource>?,

    @SerializedName("media_tracks")
    val mediaTracks: List<CanvasMediaTrack>?
)

data class CanvasMediaSource(
    @SerializedName("src")
    val src: String?,

    @SerializedName("url")
    val url: String?,

    @SerializedName("content_type")
    val contentType: String?
)

data class CanvasMediaTrack(
    @SerializedName("kind")
    val kind: String?,

    @SerializedName("src")
    val src: String?,

    @SerializedName("url")
    val url: String?,

    @SerializedName("srclang")
    val srclang: String?,

    @SerializedName("label")
    val label: String?
)

data class CourseVideo(
    val id: String,
    val title: String,
    val url: String,
    val duration: Long?,
    val createdAt: String?,
    val subtitles: List<VideoSubtitle>
)

data class VideoSubtitle(
    val label: String,
    val language: String?,
    val url: String,
    val mimeType: String?
)

data class Submission(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("assignment_id")
    val assignmentId: Long,
    
    @SerializedName("user_id")
    val userId: Long,
    
    @SerializedName("submitted_at")
    val submittedAt: String?,
    
    @SerializedName("score")
    val score: Double?,
    
    @SerializedName("grade")
    val grade: String?,
    
    @SerializedName("workflow_state")
    val workflowState: String?
)
