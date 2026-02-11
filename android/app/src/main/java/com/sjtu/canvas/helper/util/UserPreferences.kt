package com.sjtu.canvas.helper.util

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferences @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val CANVAS_TOKEN = stringPreferencesKey("canvas_token")
        private val THEME_MODE = stringPreferencesKey("theme_mode")
    }
    
    val canvasToken: Flow<String?> = dataStore.data.map { preferences ->
        preferences[CANVAS_TOKEN]
    }
    
    val themeMode: Flow<String> = dataStore.data.map { preferences ->
        preferences[THEME_MODE] ?: "system"
    }
    
    suspend fun saveCanvasToken(token: String) {
        dataStore.edit { preferences ->
            preferences[CANVAS_TOKEN] = token
        }
    }
    
    suspend fun saveThemeMode(mode: String) {
        dataStore.edit { preferences ->
            preferences[THEME_MODE] = mode
        }
    }
    
    suspend fun clearToken() {
        dataStore.edit { preferences ->
            preferences.remove(CANVAS_TOKEN)
        }
    }
}
