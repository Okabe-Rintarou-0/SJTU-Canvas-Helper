package com.sjtu.canvas.helper.data.repository

import com.sjtu.canvas.helper.data.api.CanvasApi
import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.model.CourseVideo
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.data.model.Submission
import com.sjtu.canvas.helper.data.model.VideoSubtitle
import com.sjtu.canvas.helper.data.model.User
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CanvasRepository @Inject constructor(
    private val api: CanvasApi
) {
    suspend fun validateToken(): Result<User> = withContext(Dispatchers.IO) {
        try {
            Result.success(api.getMe())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCourses(): Result<List<Course>> = withContext(Dispatchers.IO) {
        try {
            val allCourses = mutableListOf<Course>()
            var page = 1
            while (true) {
                val response = api.getCoursesPage(page = page)
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("获取课程失败: HTTP ${response.code()}")
                    )
                }
                val pageCourses = response.body().orEmpty()
                allCourses.addAll(pageCourses)
                val linkHeader = response.headers()["Link"]
                if (!hasNextPage(linkHeader) || pageCourses.isEmpty()) {
                    break
                }
                page += 1
            }
            Result.success(allCourses.distinctBy { it.id })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun hasNextPage(linkHeader: String?): Boolean {
        if (linkHeader.isNullOrBlank()) return false
        return linkHeader
            .split(",")
            .any { segment ->
                val trimmed = segment.trim()
                trimmed.contains("rel=\"next\"") || trimmed.contains("rel=next")
            }
    }
    
    suspend fun getAssignments(courseId: Long): Result<List<Assignment>> = withContext(Dispatchers.IO) {
        try {
            val assignments = api.getAssignments(courseId)
            Result.success(assignments)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
    
    suspend fun submitAssignment(
        courseId: Long,
        assignmentId: Long,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String = "application/octet-stream",
        comment: String? = null
    ): Result<Submission> = withContext(Dispatchers.IO) {
        try {
            val prepare = api.prepareSubmissionUpload(
                courseId = courseId,
                assignmentId = assignmentId,
                fileName = fileName,
                fileSize = fileBytes.size.toLong(),
            )

            val uploadUrl = prepare.uploadUrl
            val uploadParams = prepare.uploadParams

            if (uploadUrl.isNullOrBlank() || uploadParams.isNullOrEmpty()) {
                return@withContext Result.failure(
                    IllegalStateException(prepare.message ?: "Failed to prepare upload")
                )
            }

            val paramBodyMap = uploadParams.mapValues { (_, value) ->
                value.toRequestBody("text/plain".toMediaType())
            }
            val requestBody = fileBytes.toRequestBody(mimeType.toMediaTypeOrNull())
            val filePart = MultipartBody.Part.createFormData("file", fileName, requestBody)

            val uploadedFile = api.uploadSubmissionFile(
                uploadUrl = uploadUrl,
                uploadParams = paramBodyMap,
                file = filePart
            )

            val submission = api.submitAssignment(
                courseId = courseId,
                assignmentId = assignmentId,
                submissionType = "online_upload",
                fileIds = listOf(uploadedFile.id),
                comment = comment
            )
            Result.success(submission)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCourseVideos(courseId: Long): Result<List<CourseVideo>> = withContext(Dispatchers.IO) {
        try {
            val mediaObjects = api.getCourseMediaObjects(courseId)
            val videos = mediaObjects.mapNotNull { media ->
                val source = media.mediaSources
                    ?.firstOrNull { !it.url.isNullOrBlank() || !it.src.isNullOrBlank() }
                val videoUrl = source?.url ?: source?.src
                if (videoUrl.isNullOrBlank()) {
                    null
                } else {
                    CourseVideo(
                        id = media.mediaId ?: videoUrl,
                        title = media.title ?: "Untitled Video",
                        url = videoUrl,
                        duration = media.duration,
                        createdAt = media.createdAt,
                        subtitles = media.mediaTracks
                            ?.mapNotNull { track ->
                                val trackUrl = track.url ?: track.src
                                if (trackUrl.isNullOrBlank()) {
                                    null
                                } else {
                                    VideoSubtitle(
                                        label = track.label ?: track.srclang ?: "Subtitle",
                                        language = track.srclang,
                                        url = trackUrl,
                                        mimeType = guessSubtitleMimeType(trackUrl)
                                    )
                                }
                            }
                            ?: emptyList()
                    )
                }
            }
            Result.success(videos)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun guessSubtitleMimeType(url: String): String {
        val lower = url.lowercase()
        return when {
            lower.endsWith(".vtt") -> "text/vtt"
            lower.endsWith(".srt") -> "application/x-subrip"
            else -> "text/vtt"
        }
    }
}
