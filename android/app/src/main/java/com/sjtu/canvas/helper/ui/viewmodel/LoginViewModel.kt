package com.sjtu.canvas.helper.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.repository.CanvasRepository
import com.sjtu.canvas.helper.util.UserPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class LoginUiState {
    object Idle : LoginUiState()
    object Loading : LoginUiState()
    data class Error(val message: String) : LoginUiState()
    object Success : LoginUiState()
}

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val repository: CanvasRepository,
    private val userPreferences: UserPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow<LoginUiState>(LoginUiState.Idle)
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun login(token: String) {
        if (token.isBlank()) {
            _uiState.value = LoginUiState.Error("Token 不能为空")
            return
        }
        viewModelScope.launch {
            _uiState.value = LoginUiState.Loading
            userPreferences.saveCanvasToken(token)
            repository.validateToken()
                .onSuccess {
                    _uiState.value = LoginUiState.Success
                }
                .onFailure { exception ->
                    userPreferences.clearToken()
                    _uiState.value = LoginUiState.Error(
                        exception.message ?: "登录失败，请检查 Token"
                    )
                }
        }
    }

    fun checkSavedLogin(onLoggedIn: () -> Unit) {
        viewModelScope.launch {
            val token = userPreferences.canvasToken.first()
            if (!token.isNullOrBlank()) {
                _uiState.value = LoginUiState.Loading
                repository.validateToken()
                    .onSuccess {
                        _uiState.value = LoginUiState.Success
                        onLoggedIn()
                    }
                    .onFailure {
                        userPreferences.clearToken()
                        _uiState.value = LoginUiState.Idle
                    }
            }
        }
    }
}
