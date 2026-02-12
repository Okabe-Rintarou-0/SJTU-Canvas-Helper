package com.sjtu.canvas.helper.data.repository

import com.sjtu.canvas.helper.data.api.CanvasApi
import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.model.CanvasCourseFile
import com.sjtu.canvas.helper.data.model.CanvasFolder
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

    suspend fun getCourseFiles(courseId: Long): Result<List<CanvasCourseFile>> = withContext(Dispatchers.IO) {
        try {
            val allFiles = mutableListOf<CanvasCourseFile>()
            var page = 1
            while (true) {
                val response = api.getCourseFilesPage(courseId = courseId, page = page)
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        IllegalStateException("获取课程文件失败: HTTP ${response.code()}")
                    )
                }
                val pageFiles = response.body().orEmpty()
                allFiles.addAll(pageFiles)
                val linkHeader = response.headers()["Link"]
                if (!hasNextPage(linkHeader) || pageFiles.isEmpty()) {
                    break
                }
                page += 1
            }
            Result.success(allFiles.distinctBy { it.id })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCourseFolders(courseId: Long): Result<List<CanvasFolder>> = withContext(Dispatchers.IO) {
        try {
            Result.success(api.getCourseFolders(courseId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun downloadCourseFileBytes(file: CanvasCourseFile): Result<ByteArray> = withContext(Dispatchers.IO) {
        try {
            val downloadUrl = file.url
                ?: return@withContext Result.failure(IllegalStateException("文件无可下载链接: ${file.displayName}"))
            val response = api.downloadFile(downloadUrl)
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    IllegalStateException("下载失败: HTTP ${response.code()} (${file.displayName})")
                )
            }
            val body = response.body()
                ?: return@withContext Result.failure(IllegalStateException("下载失败: 响应体为空 (${file.displayName})"))
            Result.success(body.bytes())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun downloadCourseFileBytesWithProgress(
        file: CanvasCourseFile,
        onProgress: (processed: Long, total: Long) -> Unit
    ): Result<ByteArray> = withContext(Dispatchers.IO) {
        try {
            val downloadUrl = file.url
                ?: return@withContext Result.failure(IllegalStateException("文件无可下载链接: ${file.displayName}"))
            val response = api.downloadFile(downloadUrl)
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    IllegalStateException("下载失败: HTTP ${response.code()} (${file.displayName})")
                )
            }
            val body = response.body()
                ?: return@withContext Result.failure(IllegalStateException("下载失败: 响应体为空 (${file.displayName})"))

            val total = body.contentLength().takeIf { it > 0 } ?: (file.size ?: -1L)
            val input = body.byteStream()
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            val output = java.io.ByteArrayOutputStream()
            var processed = 0L
            onProgress(0L, total)
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                output.write(buffer, 0, read)
                processed += read
                onProgress(processed, total)
            }
            input.close()
            Result.success(output.toByteArray())
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
