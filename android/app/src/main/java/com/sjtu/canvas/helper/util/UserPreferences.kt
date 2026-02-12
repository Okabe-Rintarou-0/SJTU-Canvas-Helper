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
        private val JA_AUTH_COOKIE = stringPreferencesKey("ja_auth_cookie")
        private val COURSE_FILES_TREE_URI = stringPreferencesKey("course_files_tree_uri")
    }
    
    val canvasToken: Flow<String?> = dataStore.data.map { preferences ->
        preferences[CANVAS_TOKEN]
    }
    
    val themeMode: Flow<String> = dataStore.data.map { preferences ->
        preferences[THEME_MODE] ?: "system"
    }

    val jaAuthCookie: Flow<String?> = dataStore.data.map { preferences ->
        preferences[JA_AUTH_COOKIE]
    }

    val courseFilesTreeUri: Flow<String?> = dataStore.data.map { preferences ->
        preferences[COURSE_FILES_TREE_URI]
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

    suspend fun saveJaAuthCookie(cookie: String) {
        dataStore.edit { preferences ->
            preferences[JA_AUTH_COOKIE] = cookie
        }
    }

    suspend fun clearJaAuthCookie() {
        dataStore.edit { preferences ->
            preferences.remove(JA_AUTH_COOKIE)
        }
    }

    suspend fun saveCourseFilesTreeUri(uri: String) {
        dataStore.edit { preferences ->
            preferences[COURSE_FILES_TREE_URI] = uri
        }
    }

    suspend fun clearCourseFilesTreeUri() {
        dataStore.edit { preferences ->
            preferences.remove(COURSE_FILES_TREE_URI)
        }
    }
}
