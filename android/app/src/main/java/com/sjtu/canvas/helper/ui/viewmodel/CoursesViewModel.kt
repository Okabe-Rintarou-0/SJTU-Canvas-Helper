package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.data.repository.CanvasRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class CoursesUiState {
    object Loading : CoursesUiState()
    data class Success(val courses: List<Course>) : CoursesUiState()
    data class Error(val message: String) : CoursesUiState()
}

@HiltViewModel
class CoursesViewModel @Inject constructor(
    private val repository: CanvasRepository
) : ViewModel() {
    
    private val _uiState = MutableStateFlow<CoursesUiState>(CoursesUiState.Loading)
    val uiState: StateFlow<CoursesUiState> = _uiState.asStateFlow()
    
    init {
        loadCourses()
    }
    
    fun loadCourses() {
        viewModelScope.launch {
            _uiState.value = CoursesUiState.Loading
            repository.getCourses()
                .onSuccess { courses ->
                    _uiState.value = CoursesUiState.Success(courses)
                }
                .onFailure { exception ->
                    _uiState.value = CoursesUiState.Error(
                        exception.message ?: "Unknown error occurred"
                    )
                }
        }
    }
    
    fun refresh() {
        loadCourses()
    }
}
