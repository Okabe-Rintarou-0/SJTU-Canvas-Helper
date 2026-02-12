package com.sjtu.canvas.helper.data.api

import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.model.CanvasCourseFile
import com.sjtu.canvas.helper.data.model.CanvasFolder
import com.sjtu.canvas.helper.data.model.CanvasMediaObject
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.data.model.Submission
import com.sjtu.canvas.helper.data.model.SubmissionUploadPrepareResponse
import com.sjtu.canvas.helper.data.model.UploadedCanvasFile
import com.sjtu.canvas.helper.data.model.User
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface CanvasApi {

    @GET("api/v1/users/self")
    suspend fun getMe(): User
    
    @GET("api/v1/courses?include[]=term")
    suspend fun getCourses(): List<Course>

    @GET("api/v1/courses")
    suspend fun getCoursesPage(
        @Query("include[]") include: List<String> = listOf("term", "teachers"),
        @Query("per_page") perPage: Int = 100,
        @Query("page") page: Int
    ): Response<List<Course>>
    
    @GET("api/v1/courses/{courseId}/assignments")
    suspend fun getAssignments(
        @Path("courseId") courseId: Long
    ): List<Assignment>
    
    @GET("api/v1/courses/{courseId}/assignments/{assignmentId}")
    suspend fun getAssignment(
        @Path("courseId") courseId: Long,
        @Path("assignmentId") assignmentId: Long
    ): Assignment

    @FormUrlEncoded
    @POST("api/v1/courses/{courseId}/assignments/{assignmentId}/submissions/self/files")
    suspend fun prepareSubmissionUpload(
        @Path("courseId") courseId: Long,
        @Path("assignmentId") assignmentId: Long,
        @Field("name") fileName: String,
        @Field("size") fileSize: Long
    ): SubmissionUploadPrepareResponse

    @Multipart
    @POST
    suspend fun uploadSubmissionFile(
        @Url uploadUrl: String,
        @PartMap uploadParams: Map<String, @JvmSuppressWildcards RequestBody>,
        @Part file: MultipartBody.Part
    ): UploadedCanvasFile
    
    @FormUrlEncoded
    @POST("api/v1/courses/{courseId}/assignments/{assignmentId}/submissions")
    suspend fun submitAssignment(
        @Path("courseId") courseId: Long,
        @Path("assignmentId") assignmentId: Long,
        @Field("submission[submission_type]") submissionType: String,
        @Field("submission[file_ids][]") fileIds: List<Long>,
        @Field("comment[text_comment]") comment: String? = null
    ): Submission

    @GET("api/v1/courses/{courseId}/media_objects")
    suspend fun getCourseMediaObjects(
        @Path("courseId") courseId: Long
    ): List<CanvasMediaObject>
    
    @GET("api/v1/courses/{courseId}/files")
    suspend fun getCourseFilesPage(
        @Path("courseId") courseId: Long,
        @Query("per_page") perPage: Int = 100,
        @Query("page") page: Int
    ): Response<List<CanvasCourseFile>>

    @GET("api/v1/courses/{courseId}/folders")
    suspend fun getCourseFolders(
        @Path("courseId") courseId: Long,
        @Query("per_page") perPage: Int = 100
    ): List<CanvasFolder>

    @Streaming
    @GET
    suspend fun downloadFile(
        @Url fileUrl: String
    ): Response<ResponseBody>
}
