package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.model.SjtuCanvasVideo
import com.sjtu.canvas.helper.data.model.SjtuVideoInfo
import com.sjtu.canvas.helper.data.model.SjtuVideoPlayInfo
import com.sjtu.canvas.helper.data.repository.SjtuVideoRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class SjtuVideosUiState {
    object Loading : SjtuVideosUiState()
    data class Success(val videos: List<SjtuCanvasVideo>) : SjtuVideosUiState()
    data class Error(val message: String) : SjtuVideosUiState()
}

@HiltViewModel
class SjtuVideosViewModel @Inject constructor(
    private val sjtuVideoRepository: SjtuVideoRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val courseId: Long = savedStateHandle.get<String>("courseId")?.toLongOrNull() ?: 0L

    private val _uiState = MutableStateFlow<SjtuVideosUiState>(SjtuVideosUiState.Loading)
    val uiState: StateFlow<SjtuVideosUiState> = _uiState.asStateFlow()

    private val _selectedVideo = MutableStateFlow<SjtuCanvasVideo?>(null)
    val selectedVideo: StateFlow<SjtuCanvasVideo?> = _selectedVideo.asStateFlow()

    private val _videoInfo = MutableStateFlow<SjtuVideoInfo?>(null)
    val videoInfo: StateFlow<SjtuVideoInfo?> = _videoInfo.asStateFlow()

    private val _primaryPlay = MutableStateFlow<SjtuVideoPlayInfo?>(null)
    val primaryPlay: StateFlow<SjtuVideoPlayInfo?> = _primaryPlay.asStateFlow()

    private val _secondaryPlay = MutableStateFlow<SjtuVideoPlayInfo?>(null)
    val secondaryPlay: StateFlow<SjtuVideoPlayInfo?> = _secondaryPlay.asStateFlow()

    private val _subtitlePath = MutableStateFlow<String?>(null)
    val subtitlePath: StateFlow<String?> = _subtitlePath.asStateFlow()

    init {
        loadVideos()
    }

    fun loadVideos() {
        viewModelScope.launch {
            _uiState.value = SjtuVideosUiState.Loading
            sjtuVideoRepository.getCanvasVideos(courseId)
                .onSuccess { videos ->
                    _uiState.value = SjtuVideosUiState.Success(videos)
                }
                .onFailure { e ->
                    _uiState.value = SjtuVideosUiState.Error(e.message ?: "加载回放失败")
                }
        }
    }

    fun selectVideo(video: SjtuCanvasVideo) {
        _selectedVideo.value = video
        _videoInfo.value = null
        _primaryPlay.value = null
        _secondaryPlay.value = null
        _subtitlePath.value = null

        viewModelScope.launch {
            sjtuVideoRepository.getCanvasVideoInfo(video.videoId)
                .onSuccess { info ->
                    _videoInfo.value = info
                    _primaryPlay.value = info.videoPlayResponseVoList.firstOrNull()
                    sjtuVideoRepository.getSubtitleVtt(info.courId)
                        .onSuccess { path ->
                            _subtitlePath.value = path
                        }
                }
                .onFailure { e ->
                    _uiState.value = SjtuVideosUiState.Error(e.message ?: "获取播放源失败")
                }
        }
    }

    fun setPrimary(play: SjtuVideoPlayInfo) {
        _primaryPlay.value = play
        if (_secondaryPlay.value?.id == play.id) {
            _secondaryPlay.value = null
        }
    }

    fun toggleSecondary(play: SjtuVideoPlayInfo) {
        _secondaryPlay.value = if (_secondaryPlay.value?.id == play.id) null else play
    }
}
