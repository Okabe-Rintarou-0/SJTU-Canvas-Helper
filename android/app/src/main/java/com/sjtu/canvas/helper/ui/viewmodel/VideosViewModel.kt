package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.model.CourseVideo
import com.sjtu.canvas.helper.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class VideosUiState {
    object Loading : VideosUiState()
    data class Success(val videos: List<CourseVideo>) : VideosUiState()
    data class Error(val message: String) : VideosUiState()
}

@HiltViewModel
class VideosViewModel @Inject constructor(
    private val repository: CanvasRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val courseId: Long = savedStateHandle.get<String>("courseId")?.toLongOrNull() ?: 0L

    private val _uiState = MutableStateFlow<VideosUiState>(VideosUiState.Loading)
    val uiState: StateFlow<VideosUiState> = _uiState.asStateFlow()

    private val _primaryVideo = MutableStateFlow<CourseVideo?>(null)
    val primaryVideo: StateFlow<CourseVideo?> = _primaryVideo.asStateFlow()

    private val _secondaryVideo = MutableStateFlow<CourseVideo?>(null)
    val secondaryVideo: StateFlow<CourseVideo?> = _secondaryVideo.asStateFlow()

    init {
        loadVideos()
    }

    fun loadVideos() {
        viewModelScope.launch {
            _uiState.value = VideosUiState.Loading
            repository.getCourseVideos(courseId)
                .onSuccess { videos ->
                    _uiState.value = VideosUiState.Success(videos)
                    if (_primaryVideo.value == null) {
                        _primaryVideo.value = videos.firstOrNull()
                    }
                }
                .onFailure { exception ->
                    _uiState.value = VideosUiState.Error(
                        exception.message ?: "加载视频失败"
                    )
                }
        }
    }

    fun setPrimaryVideo(video: CourseVideo) {
        _primaryVideo.value = video
        if (_secondaryVideo.value?.id == video.id) {
            _secondaryVideo.value = null
        }
    }

    fun toggleSecondaryVideo(video: CourseVideo) {
        _secondaryVideo.value = if (_secondaryVideo.value?.id == video.id) null else video
    }
}
