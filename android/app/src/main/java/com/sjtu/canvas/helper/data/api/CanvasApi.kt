package com.sjtu.canvas.helper.data.api

import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.data.model.Submission
import okhttp3.MultipartBody
import retrofit2.http.*

interface CanvasApi {
    
    @GET("api/v1/courses")
    suspend fun getCourses(
        @Query("enrollment_state") enrollmentState: String = "active"
    ): List<Course>
    
    @GET("api/v1/courses/{courseId}/assignments")
    suspend fun getAssignments(
        @Path("courseId") courseId: Long
    ): List<Assignment>
    
    @GET("api/v1/courses/{courseId}/assignments/{assignmentId}")
    suspend fun getAssignment(
        @Path("courseId") courseId: Long,
        @Path("assignmentId") assignmentId: Long
    ): Assignment
    
    @Multipart
    @POST("api/v1/courses/{courseId}/assignments/{assignmentId}/submissions")
    suspend fun submitAssignment(
        @Path("courseId") courseId: Long,
        @Path("assignmentId") assignmentId: Long,
        @Part file: MultipartBody.Part
    ): Submission
    
    @GET("api/v1/users/self/courses/{courseId}/files")
    suspend fun getCourseFiles(
        @Path("courseId") courseId: Long
    ): List<Any>
}
