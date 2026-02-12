package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.Gson
import com.sjtu.canvas.helper.data.repository.SjtuVideoRepository
import com.sjtu.canvas.helper.util.UserPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import javax.inject.Inject

sealed class VideoLoginState {
    object Idle : VideoLoginState()
    object Loading : VideoLoginState()
    data class ShowQr(val qrUrl: String) : VideoLoginState()
    object LoggedIn : VideoLoginState()
    data class Error(val message: String) : VideoLoginState()
}

@HiltViewModel
class VideoLoginViewModel @Inject constructor(
    private val sjtuVideoRepository: SjtuVideoRepository,
    private val userPreferences: UserPreferences
) : ViewModel() {

    private val gson = Gson()
    private val wsClient = OkHttpClient()

    private var websocket: WebSocket? = null
    private var refreshJob: Job? = null
    private var uuid: String? = null

    private val _state = MutableStateFlow<VideoLoginState>(VideoLoginState.Idle)
    val state: StateFlow<VideoLoginState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            // If we already have a cookie, try to validate it silently.
            val cookie = userPreferences.jaAuthCookie.first()
            if (!cookie.isNullOrBlank()) {
                sjtuVideoRepository.loginCanvasAndVideoWebsites()
                    .onSuccess { _state.value = VideoLoginState.LoggedIn }
                    .onFailure { /* keep Idle */ }
            }
        }
    }

    fun startQrLogin() {
        viewModelScope.launch {
            _state.value = VideoLoginState.Loading
            sjtuVideoRepository.getUuid()
                .onSuccess { u ->
                    uuid = u
                    openWebSocket(u)
                }
                .onFailure { e ->
                    _state.value = VideoLoginState.Error(e.message ?: "获取 uuid 失败")
                }
        }
    }

    fun cancel() {
        refreshJob?.cancel()
        refreshJob = null
        websocket?.close(1000, "cancel")
        websocket = null
        _state.value = VideoLoginState.Idle
    }

    private fun openWebSocket(uuid: String) {
        websocket?.close(1000, "restart")
        val request = Request.Builder().url("$WEBSOCKET_BASE_URL/$uuid").build()
        websocket = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: okhttp3.Response) {
                refreshJob?.cancel()
                refreshJob = viewModelScope.launch {
                    while (true) {
                        webSocket.send(UPDATE_QR_CODE_MESSAGE)
                        delay(50_000)
                    }
                }
                webSocket.send(UPDATE_QR_CODE_MESSAGE)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                handleMessage(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                _state.value = VideoLoginState.Error(t.message ?: "WebSocket 连接失败")
            }
        })
    }

    private fun handleMessage(text: String) {
        val msg = runCatching { gson.fromJson(text, LoginMessage::class.java) }.getOrNull() ?: return
        when (msg.type.uppercase()) {
            "UPDATE_QR_CODE" -> {
                val u = uuid ?: return
                val qr = "$QRCODE_BASE_URL?uuid=$u&ts=${msg.payload.ts}&sig=${msg.payload.sig}"
                _state.value = VideoLoginState.ShowQr(qr)
            }

            "LOGIN" -> {
                val u = uuid ?: return
                viewModelScope.launch {
                    _state.value = VideoLoginState.Loading
                    sjtuVideoRepository.expressLogin(u)
                        .onSuccess { cookie ->
                            userPreferences.saveJaAuthCookie(cookie)
                            sjtuVideoRepository.loginCanvasAndVideoWebsites()
                                .onSuccess {
                                    _state.value = VideoLoginState.LoggedIn
                                    websocket?.close(1000, "done")
                                }
                                .onFailure { e ->
                                    _state.value = VideoLoginState.Error(e.message ?: "登录校验失败")
                                }
                        }
                        .onFailure { e ->
                            _state.value = VideoLoginState.Error(e.message ?: "获取 JAAuthCookie 失败")
                        }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        cancel()
    }

    private data class LoginMessage(
        val error: Int,
        val payload: Payload,
        val type: String
    )

    private data class Payload(
        val sig: String,
        val ts: Long
    )

    companion object {
        private const val WEBSOCKET_BASE_URL = "wss://jaccount.sjtu.edu.cn/jaccount/sub"
        private const val QRCODE_BASE_URL = "https://jaccount.sjtu.edu.cn/jaccount/confirmscancode"
        private const val UPDATE_QR_CODE_MESSAGE = "{ \"type\": \"UPDATE_QR_CODE\" }"
    }
}
