package com.sjtu.canvas.helper.data.model

import com.google.gson.annotations.SerializedName

data class SjtuCanvasVideo(
    @SerializedName("videoId")
    val videoId: String,

    @SerializedName("userName")
    val userName: String?,

    @SerializedName("videoName")
    val videoName: String,

    @SerializedName("classroomName")
    val classroomName: String?,

    @SerializedName("courseBeginTime")
    val courseBeginTime: String?,

    @SerializedName("courseEndTime")
    val courseEndTime: String?
)

data class SjtuGetCanvasVideoInfoResponse(
    @SerializedName("code")
    val code: String?,

    @SerializedName("data")
    val data: SjtuVideoInfo
)

data class SjtuVideoInfo(
    @SerializedName("id")
    val id: Long,

    @SerializedName("courId")
    val courId: Long,

    @SerializedName("videName")
    val videName: String?,

    @SerializedName("videoPlayResponseVoList")
    val videoPlayResponseVoList: List<SjtuVideoPlayInfo>
)

data class SjtuVideoPlayInfo(
    @SerializedName("id")
    val id: Long,

    @SerializedName("rtmpUrlHdv")
    val rtmpUrlHdv: String,

    @SerializedName("cdviChannelNum")
    val cdviChannelNum: Long?
)

data class SjtuCanvasVideoResponse(
    @SerializedName("code")
    val code: String?,

    @SerializedName("data")
    val data: SjtuCanvasVideoResponseBody?
)

data class SjtuCanvasVideoResponseBody(
    @SerializedName("records")
    val records: List<SjtuCanvasVideo>
)

data class SjtuSubtitleResponse(
    @SerializedName("code")
    val code: String?,

    @SerializedName("data")
    val data: SjtuSubtitleBody?,

    @SerializedName("status")
    val status: Long?
)

data class SjtuSubtitleBody(
    @SerializedName("beforeAssemblyList")
    val beforeAssemblyList: List<SjtuSubtitleItem>?,

    @SerializedName("afterAssemblyList")
    val afterAssemblyList: List<SjtuSubtitleItem>?
)

data class SjtuSubtitleItem(
    @SerializedName("bg")
    val bg: Long,

    @SerializedName("ed")
    val ed: Long,

    @SerializedName("res")
    val res: String,

    @SerializedName("zh")
    val zh: String?,

    @SerializedName("en")
    val en: String?
)
