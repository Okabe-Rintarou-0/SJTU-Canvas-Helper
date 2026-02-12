package com.sjtu.canvas.helper.data.repository

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.sjtu.canvas.helper.data.model.SjtuCanvasVideo
import com.sjtu.canvas.helper.data.model.SjtuCanvasVideoResponse
import com.sjtu.canvas.helper.data.model.SjtuGetCanvasVideoInfoResponse
import com.sjtu.canvas.helper.data.model.SjtuSubtitleResponse
import com.sjtu.canvas.helper.data.model.SjtuVideoInfo
import com.sjtu.canvas.helper.util.UserPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.JavaNetCookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.jsoup.Jsoup
import java.io.File
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.HttpCookie
import java.net.URI
import java.util.concurrent.TimeUnit
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SjtuVideoRepository @Inject constructor(
    private val userPreferences: UserPreferences,
    @ApplicationContext private val context: Context
) {
    private val gson = Gson()

    private val cookieManager = CookieManager().apply {
        setCookiePolicy(CookiePolicy.ACCEPT_ALL)
    }

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(JavaNetCookieJar(cookieManager))
        .followRedirects(true)
        .followSslRedirects(true)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var videoToken: String? = null

    private suspend fun ensureJaAuthCookie(): String {
        val cookie = userPreferences.jaAuthCookie.first()
        return cookie ?: ""
    }

    private fun seedJaAuthCookieToJar(jaAuthCookie: String) {
        if (jaAuthCookie.isBlank()) return
        val cookie = HttpCookie("JAAuthCookie", jaAuthCookie).apply {
            domain = "jaccount.sjtu.edu.cn"
            path = "/"
            isHttpOnly = true
            secure = true
        }
        cookieManager.cookieStore.add(URI("https://jaccount.sjtu.edu.cn"), cookie)
    }

    suspend fun getUuid(): Result<String> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(MY_SJTU_URL).get().build()
            val body = okHttpClient.newCall(req).execute().use { it.body?.string().orEmpty() }
            val regex = Regex("uuid=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")
            val uuid = regex.find(body)?.groupValues?.getOrNull(1)
            if (uuid.isNullOrBlank()) {
                Result.failure(IllegalStateException("未获取到 uuid"))
            } else {
                Result.success(uuid)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun expressLogin(uuid: String): Result<String> = withContext(Dispatchers.IO) {
        try {
            val url = "$EXPRESS_LOGIN_URL?uuid=$uuid"
            val req = Request.Builder().url(url).get().build()
            okHttpClient.newCall(req).execute().close()

            val cookies = cookieManager.cookieStore.cookies
            val ja = cookies.firstOrNull { it.name == "JAAuthCookie" }?.value
            if (ja.isNullOrBlank()) {
                Result.failure(IllegalStateException("未获取到 JAAuthCookie"))
            } else {
                Result.success(ja)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun loginCanvasAndVideoWebsites(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val ja = ensureJaAuthCookie()
            if (ja.isBlank()) {
                return@withContext Result.failure(IllegalStateException("未登录 SJTU（缺少 JAAuthCookie）"))
            }
            seedJaAuthCookieToJar(ja)

            okHttpClient.newCall(Request.Builder().url(CANVAS_LOGIN_URL).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return@withContext Result.failure(IllegalStateException("Canvas 网站登录失败：${resp.code}"))
                }
                val finalHost = resp.request.url.host
                if (finalHost.contains("jaccount")) {
                    return@withContext Result.failure(IllegalStateException("Canvas 登录未完成（仍停留在 jaccount）"))
                }
            }

            okHttpClient.newCall(Request.Builder().url(VIDEO_LOGIN_URL).get().build()).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return@withContext Result.failure(IllegalStateException("视频网站登录失败：${resp.code}"))
                }
                val finalHost = resp.request.url.host
                if (finalHost.contains("jaccount")) {
                    return@withContext Result.failure(IllegalStateException("视频网站登录未完成（仍停留在 jaccount）"))
                }
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCanvasVideos(courseId: Long): Result<List<SjtuCanvasVideo>> = withContext(Dispatchers.IO) {
        try {
            loginCanvasAndVideoWebsites().getOrThrow()

            val tokenId = getTokenId(courseId)
            val (canvasCourseId, token) = getCanvasCourseIdTokenByTokenId(tokenId)
            videoToken = token

            val url = "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/findVodVideoList"
            val json = JsonObject().apply {
                addProperty("canvasCourseId", java.net.URLEncoder.encode(canvasCourseId, "UTF-8"))
            }
            val reqBody = gson.toJson(json)
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val req = Request.Builder()
                .url(url)
                .addHeader("Referer", "https://v.sjtu.edu.cn/jy-application-canvas-sjtu-ui/")
                .addHeader("token", token)
                .post(reqBody)
                .build()

            val respText = okHttpClient.newCall(req).execute().use { response ->
                response.body?.string().orEmpty()
            }
            val parsed = gson.fromJson(respText, SjtuCanvasVideoResponse::class.java)
            val records = parsed.data?.records ?: emptyList()
            Result.success(records)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getCanvasVideoInfo(videoId: String): Result<SjtuVideoInfo> = withContext(Dispatchers.IO) {
        try {
            val token = videoToken ?: return@withContext Result.failure(IllegalStateException("视频 token 不存在，请先加载视频列表"))
            val form = FormBody.Builder()
                .add("playTypeHls", "true")
                .add("id", videoId)
                .add("isAudit", "true")
                .build()

            val req = Request.Builder()
                .url("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/directOnDemandPlay/getVodVideoInfos")
                .addHeader("token", token)
                .post(form)
                .build()

            val respText = okHttpClient.newCall(req).execute().use { response ->
                response.body?.string().orEmpty()
            }
            val parsed = gson.fromJson(respText, SjtuGetCanvasVideoInfoResponse::class.java)
            Result.success(parsed.data)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSubtitleVtt(canvasCourseId: Long): Result<String> = withContext(Dispatchers.IO) {
        try {
            val token = videoToken ?: return@withContext Result.failure(IllegalStateException("视频 token 不存在，请先加载视频列表"))
            val form = FormBody.Builder()
                .add("courseId", canvasCourseId.toString())
                .build()
            val req = Request.Builder()
                .url("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/transfer/translate/detail")
                .addHeader("token", token)
                .post(form)
                .build()

            val respText = okHttpClient.newCall(req).execute().use { response ->
                response.body?.string().orEmpty()
            }
            val parsed = gson.fromJson(respText, SjtuSubtitleResponse::class.java)
            val items = parsed.data?.beforeAssemblyList ?: parsed.data?.afterAssemblyList ?: emptyList()
            if (items.isEmpty()) {
                return@withContext Result.failure(IllegalStateException("字幕为空"))
            }
            val vtt = buildWebVtt(
                items.map { item ->
                    SubtitleEntry(
                        beginMs = item.bg,
                        endMs = item.ed,
                        text = (item.zh ?: item.res).trim()
                    )
                }
            )
            val file = File(context.cacheDir, "subtitle_${canvasCourseId}.vtt")
            file.writeText(vtt)
            Result.success(file.absolutePath)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun getTokenId(courseId: Long): String {
        val externalToolUrl = "https://oc.sjtu.edu.cn/courses/$courseId/external_tools/8329"
        val html = okHttpClient.newCall(Request.Builder().url(externalToolUrl).get().build())
            .execute().use { it.body?.string().orEmpty() }

        val doc = Jsoup.parse(html)
        val form1 = doc.selectFirst("form[action='https://v.sjtu.edu.cn/jy-application-canvas-sjtu/oidc/login_initiations']")
            ?: throw IllegalStateException("未找到 login_initiations 表单")
        val formData1 = form1.select("input[name]").associate { el ->
            el.attr("name") to el.attr("value")
        }

        val body1 = FormBody.Builder().apply {
            formData1.forEach { (k, v) -> add(k, v) }
        }.build()

        val html2 = okHttpClient.newCall(
            Request.Builder()
                .url("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/oidc/login_initiations")
                .post(body1)
                .build()
        ).execute().use { it.body?.string().orEmpty() }

        val doc2 = Jsoup.parse(html2)
        val form2 = doc2.selectFirst("form[action='https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/lti3Auth/ivs']")
            ?: throw IllegalStateException("未找到 lti3Auth/ivs 表单")
        val formData2 = form2.select("input[name]").associate { el ->
            el.attr("name") to el.attr("value")
        }

        val noRedirectClient = okHttpClient.newBuilder().followRedirects(false).followSslRedirects(false).build()
        val body2 = FormBody.Builder().apply {
            formData2.forEach { (k, v) -> add(k, v) }
        }.build()

        val resp = noRedirectClient.newCall(
            Request.Builder()
                .url("https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/lti3Auth/ivs")
                .post(body2)
                .build()
        ).execute()

        resp.use {
            val location = it.header("location") ?: throw IllegalStateException("未获取到 tokenId 重定向")
            val parts = location.split('?', '&')
            val tokenId = parts.firstOrNull { s -> s.startsWith("tokenId=") }
                ?.removePrefix("tokenId=")
            return tokenId ?: throw IllegalStateException("重定向中未包含 tokenId")
        }
    }

    private fun getCanvasCourseIdTokenByTokenId(tokenId: String): Pair<String, String> {
        val url = "https://v.sjtu.edu.cn/jy-application-canvas-sjtu/lti3/getAccessTokenByTokenId?tokenId=$tokenId"
        val respText = okHttpClient.newCall(Request.Builder().url(url).get().build())
            .execute().use { it.body?.string().orEmpty() }

        val json = gson.fromJson(respText, JsonObject::class.java)
        val token = json.getAsJsonObject("data").get("token")?.asString
            ?: throw IllegalStateException("未获取到 token")
        val courId = json.getAsJsonObject("data")
            .getAsJsonObject("params")
            .get("courId")?.asString
            ?: throw IllegalStateException("未获取到 courId")
        return courId to token
    }

    companion object {
        private const val MY_SJTU_URL = "https://my.sjtu.edu.cn/ui/appmyinfo"
        private const val EXPRESS_LOGIN_URL = "https://jaccount.sjtu.edu.cn/jaccount/expresslogin"
        private const val CANVAS_LOGIN_URL = "https://oc.sjtu.edu.cn/login/openid_connect"
        private const val VIDEO_LOGIN_URL = "https://courses.sjtu.edu.cn/app/oauth/2.0/login?login_type=outer"
    }
}

private data class SubtitleEntry(
    val beginMs: Long,
    val endMs: Long,
    val text: String
)

private fun buildWebVtt(entries: List<SubtitleEntry>): String {
    val sb = StringBuilder()
    sb.append("WEBVTT\n\n")
    for (entry in entries) {
        sb.append(formatVttTime(entry.beginMs))
        sb.append(" --> ")
        sb.append(formatVttTime(entry.endMs))
        sb.append("\n")
        sb.append(entry.text)
        sb.append("\n\n")
    }
    return sb.toString()
}

private fun formatVttTime(ms: Long): String {
    val totalMs = if (ms < 0) 0 else ms
    val hours = totalMs / 3_600_000
    val minutes = (totalMs % 3_600_000) / 60_000
    val seconds = (totalMs % 60_000) / 1_000
    val millis = totalMs % 1_000
    return String.format("%02d:%02d:%02d.%03d", hours, minutes, seconds, millis)
}
