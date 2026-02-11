package com.sjtu.canvas.helper.data.repository

import com.sjtu.canvas.helper.data.api.CanvasApi
import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.data.model.Submission
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MultipartBody
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class CanvasRepository @Inject constructor(
    private val api: CanvasApi
) {
    suspend fun getCourses(): Result<List<Course>> = withContext(Dispatchers.IO) {
        try {
            val courses = api.getCourses()
            Result.success(courses)
        } catch (e: Exception) {
            Result.failure(e)
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
        file: MultipartBody.Part
    ): Result<Submission> = withContext(Dispatchers.IO) {
        try {
            val submission = api.submitAssignment(courseId, assignmentId, file)
            Result.success(submission)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
