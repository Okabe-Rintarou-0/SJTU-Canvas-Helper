package com.sjtu.canvas.helper.data.model

import com.google.gson.annotations.SerializedName

data class Course(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("name")
    val name: String,
    
    @SerializedName("course_code")
    val courseCode: String?,
    
    @SerializedName("start_at")
    val startAt: String?,
    
    @SerializedName("end_at")
    val endAt: String?,
    
    @SerializedName("enrollment_term_id")
    val enrollmentTermId: Long?,
    
    @SerializedName("workflow_state")
    val workflowState: String?
)

data class Assignment(
    @SerializedName("id")
    val id: Long,
    
    @SerializedName("name")
    val name: String,
    
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
