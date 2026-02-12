package com.sjtu.canvas.helper.ui.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.util.UserPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val userPreferences: UserPreferences
) : ViewModel() {

    private val _courseFilesTreeUri = MutableStateFlow<String?>(null)
    val courseFilesTreeUri: StateFlow<String?> = _courseFilesTreeUri.asStateFlow()

    init {
        viewModelScope.launch {
            _courseFilesTreeUri.value = userPreferences.courseFilesTreeUri.first()
        }
    }

    fun saveCourseFilesTreeUri(uri: Uri) {
        viewModelScope.launch {
            userPreferences.saveCourseFilesTreeUri(uri.toString())
            _courseFilesTreeUri.value = uri.toString()
        }
    }

    fun clearCourseFilesTreeUri() {
        viewModelScope.launch {
            userPreferences.clearCourseFilesTreeUri()
            _courseFilesTreeUri.value = null
        }
    }
}
