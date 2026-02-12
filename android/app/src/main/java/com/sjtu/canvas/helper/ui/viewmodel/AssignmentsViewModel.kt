package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class AssignmentsUiState {
    object Loading : AssignmentsUiState()
    data class Success(val assignments: List<Assignment>) : AssignmentsUiState()
    data class Error(val message: String) : AssignmentsUiState()
}

sealed class UploadState {
    object Idle : UploadState()
    object Uploading : UploadState()
    object Success : UploadState()
    data class Error(val message: String) : UploadState()
}

@HiltViewModel
class AssignmentsViewModel @Inject constructor(
    private val repository: CanvasRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {
    
    private val courseId: Long = savedStateHandle.get<String>("courseId")?.toLongOrNull() ?: 0L
    
    private val _uiState = MutableStateFlow<AssignmentsUiState>(AssignmentsUiState.Loading)
    val uiState: StateFlow<AssignmentsUiState> = _uiState.asStateFlow()
    
    private val _uploadState = MutableStateFlow<UploadState>(UploadState.Idle)
    val uploadState: StateFlow<UploadState> = _uploadState.asStateFlow()
    
    init {
        loadAssignments()
    }
    
    private fun loadAssignments() {
        viewModelScope.launch {
            _uiState.value = AssignmentsUiState.Loading
            repository.getAssignments(courseId)
                .onSuccess { assignments ->
                    _uiState.value = AssignmentsUiState.Success(assignments)
                }
                .onFailure { exception ->
                    _uiState.value = AssignmentsUiState.Error(
                        exception.message ?: "Failed to load assignments"
                    )
                }
        }
    }
    
    fun uploadAssignment(
        assignmentId: Long,
        fileName: String,
        fileBytes: ByteArray,
        mimeType: String
    ) {
        viewModelScope.launch {
            _uploadState.value = UploadState.Uploading
            repository.submitAssignment(
                courseId = courseId,
                assignmentId = assignmentId,
                fileName = fileName,
                fileBytes = fileBytes,
                mimeType = mimeType
            ).onSuccess {
                _uploadState.value = UploadState.Success
                loadAssignments()
            }.onFailure { exception ->
                _uploadState.value = UploadState.Error(
                    exception.message ?: "上传失败"
                )
            }
        }
    }
    
    fun resetUploadState() {
        _uploadState.value = UploadState.Idle
    }
    
    fun refresh() {
        loadAssignments()
    }
}
