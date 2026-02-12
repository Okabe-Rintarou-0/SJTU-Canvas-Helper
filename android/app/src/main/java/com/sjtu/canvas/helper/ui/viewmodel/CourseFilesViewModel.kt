package com.sjtu.canvas.helper.ui.viewmodel

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sjtu.canvas.helper.data.model.CanvasCourseFile
import com.sjtu.canvas.helper.data.model.CanvasFolder
import com.sjtu.canvas.helper.data.repository.CanvasRepository
import com.sjtu.canvas.helper.util.UserPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class CourseFilesUiState {
    object Loading : CourseFilesUiState()
    data class Success(
        val files: List<CanvasCourseFile>,
        val foldersMap: Map<Long, CanvasFolder>
    ) : CourseFilesUiState()

    data class Error(val message: String) : CourseFilesUiState()
}

data class DownloadProgress(
    val processed: Long,
    val total: Long,
    val finished: Boolean = false
) {
    val ratio: Float
        get() = if (total > 0) (processed.toFloat() / total.toFloat()).coerceIn(0f, 1f) else 0f
}

sealed class CourseFilesEvent {
    data class Message(val text: String) : CourseFilesEvent()
    data class OpenFile(val uri: Uri, val mimeType: String) : CourseFilesEvent()
}

@HiltViewModel
class CourseFilesViewModel @Inject constructor(
    private val repository: CanvasRepository,
    private val userPreferences: UserPreferences,
    @ApplicationContext private val context: Context,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val courseId: Long = savedStateHandle.get<String>("courseId")?.toLongOrNull() ?: 0L

    private val _uiState = MutableStateFlow<CourseFilesUiState>(CourseFilesUiState.Loading)
    val uiState: StateFlow<CourseFilesUiState> = _uiState.asStateFlow()

    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private val _syncingCount = MutableStateFlow(0)
    val syncingCount: StateFlow<Int> = _syncingCount.asStateFlow()

    private val _courseIdentifier = MutableStateFlow<String?>(null)

    private val _downloadProgress = MutableStateFlow<Map<Long, DownloadProgress>>(emptyMap())
    val downloadProgress: StateFlow<Map<Long, DownloadProgress>> = _downloadProgress.asStateFlow()

    private val _events = MutableSharedFlow<CourseFilesEvent>()
    val events: SharedFlow<CourseFilesEvent> = _events.asSharedFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = CourseFilesUiState.Loading
            val foldersResult = repository.getCourseFolders(courseId)
            val filesResult = repository.getCourseFiles(courseId)
            foldersResult
                .onFailure {
                    _uiState.value = CourseFilesUiState.Error(it.message ?: "获取课程文件夹失败")
                    return@launch
                }
            filesResult
                .onFailure {
                    _uiState.value = CourseFilesUiState.Error(it.message ?: "获取课程文件失败")
                    return@launch
                }

            val folders = foldersResult.getOrDefault(emptyList())
            val files = filesResult.getOrDefault(emptyList())
                .filter { !it.url.isNullOrBlank() }
            repository.getCourses().onSuccess { courses ->
                val course = courses.find { it.id == courseId }
                if (course != null) {
                    val name = course.name?.trim().orEmpty()
                    val term = course.term?.name?.trim().orEmpty()
                    val teacher = course.teachers?.firstOrNull()?.displayName?.trim().orEmpty()
                    val composed = if (name.isNotBlank() && term.isNotBlank() && teacher.isNotBlank()) {
                        "$name($term $teacher)"
                    } else {
                        name
                    }
                    _courseIdentifier.value = composed.ifBlank { null }
                }
            }
            _uiState.value = CourseFilesUiState.Success(
                files = files,
                foldersMap = folders.associateBy { it.id }
            )
        }
    }

    fun downloadSingle(file: CanvasCourseFile) {
        viewModelScope.launch {
            val state = _uiState.value as? CourseFilesUiState.Success ?: return@launch
            val tree = getRootTreeDocument() ?: return@launch
            val relativeFolder = resolveRelativeFolder(file, state.foldersMap) ?: run {
                _events.emit(CourseFilesEvent.Message("无法解析文件目录: ${file.displayName}"))
                return@launch
            }

            val courseDir = ensureDirectory(tree, courseIdentifier())
            if (courseDir == null) {
                _events.emit(CourseFilesEvent.Message("创建课程目录失败"))
                return@launch
            }
            val targetDir = ensureDirectory(courseDir, relativeFolder)
            if (targetDir == null) {
                _events.emit(CourseFilesEvent.Message("创建目标目录失败: $relativeFolder"))
                return@launch
            }

            repository.downloadCourseFileBytesWithProgress(file) { processed, total ->
                _downloadProgress.value = _downloadProgress.value + (
                    file.id to DownloadProgress(processed = processed, total = total)
                )
            }
                .onSuccess { bytes ->
                    val saved = writeBytesToFile(targetDir, file, bytes)
                    if (saved) {
                        val finalTotal = _downloadProgress.value[file.id]?.total ?: file.size ?: bytes.size.toLong()
                        markProgressFinished(
                            fileId = file.id,
                            processed = bytes.size.toLong(),
                            total = if (finalTotal > 0) finalTotal else bytes.size.toLong()
                        )
                        _events.emit(CourseFilesEvent.Message("已下载: ${file.displayName}"))
                    } else {
                        _downloadProgress.value = _downloadProgress.value - file.id
                        _events.emit(CourseFilesEvent.Message("写入失败: ${file.displayName}"))
                    }
                }
                .onFailure {
                    _downloadProgress.value = _downloadProgress.value - file.id
                    _events.emit(CourseFilesEvent.Message(it.message ?: "下载失败: ${file.displayName}"))
                }
        }
    }

    fun openFile(file: CanvasCourseFile) {
        viewModelScope.launch {
            val state = _uiState.value as? CourseFilesUiState.Success ?: return@launch
            val tree = getRootTreeDocument() ?: return@launch
            val relativeFolder = resolveRelativeFolder(file, state.foldersMap) ?: run {
                _events.emit(CourseFilesEvent.Message("无法解析文件目录: ${file.displayName}"))
                return@launch
            }
            val courseDir = findDirectory(tree, courseIdentifier()) ?: run {
                _events.emit(CourseFilesEvent.Message("文件未下载：${file.displayName}"))
                return@launch
            }
            val targetDir = findDirectory(courseDir, relativeFolder) ?: run {
                _events.emit(CourseFilesEvent.Message("文件未下载：${file.displayName}"))
                return@launch
            }
            val targetFile = targetDir.findFile(file.displayName)
            if (targetFile == null || !targetFile.isFile) {
                _events.emit(CourseFilesEvent.Message("文件未下载：${file.displayName}"))
                return@launch
            }
            _events.emit(CourseFilesEvent.OpenFile(
                uri = targetFile.uri,
                mimeType = file.contentType ?: "application/octet-stream"
            ))
        }
    }

    fun syncAll() {
        viewModelScope.launch {
            val state = _uiState.value as? CourseFilesUiState.Success ?: return@launch
            if (_isSyncing.value) return@launch

            val tree = getRootTreeDocument() ?: return@launch
            val courseDir = ensureDirectory(tree, courseIdentifier())
            if (courseDir == null) {
                _events.emit(CourseFilesEvent.Message("创建课程目录失败"))
                return@launch
            }

            _isSyncing.value = true
            try {
                val filesToSync = state.files.filter { file ->
                    val relativeFolder = resolveRelativeFolder(file, state.foldersMap)
                    if (relativeFolder == null) {
                        false
                    } else {
                        val targetDir = findDirectory(courseDir, relativeFolder)
                        targetDir?.findFile(file.displayName) == null
                    }
                }

                _syncingCount.value = filesToSync.size
                if (filesToSync.isEmpty()) {
                    _events.emit(CourseFilesEvent.Message("已同步，无需下载"))
                    return@launch
                }

                var successCount = 0
                filesToSync.forEach { file ->
                    val relativeFolder = resolveRelativeFolder(file, state.foldersMap) ?: return@forEach
                    val targetDir = ensureDirectory(courseDir, relativeFolder) ?: return@forEach
                    repository.downloadCourseFileBytesWithProgress(file) { processed, total ->
                        _downloadProgress.value = _downloadProgress.value + (
                            file.id to DownloadProgress(processed = processed, total = total)
                        )
                    }
                        .onSuccess { bytes ->
                            if (writeBytesToFile(targetDir, file, bytes)) {
                                successCount += 1
                                val finalTotal = _downloadProgress.value[file.id]?.total ?: file.size ?: bytes.size.toLong()
                                markProgressFinished(
                                    fileId = file.id,
                                    processed = bytes.size.toLong(),
                                    total = if (finalTotal > 0) finalTotal else bytes.size.toLong()
                                )
                            } else {
                                _downloadProgress.value = _downloadProgress.value - file.id
                            }
                        }
                        .onFailure {
                            _downloadProgress.value = _downloadProgress.value - file.id
                        }
                }
                _events.emit(CourseFilesEvent.Message("同步完成：$successCount / ${filesToSync.size}"))
            } finally {
                _isSyncing.value = false
                _syncingCount.value = 0
            }
        }
    }

    private suspend fun getRootTreeDocument(): DocumentFile? {
        val uriText = userPreferences.courseFilesTreeUri.first()
        if (uriText.isNullOrBlank()) {
            _events.emit(CourseFilesEvent.Message("请先到设置里配置课程文件存储位置"))
            return null
        }
        val root = DocumentFile.fromTreeUri(context, Uri.parse(uriText))
        if (root == null || !root.canRead() || !root.canWrite()) {
            _events.emit(CourseFilesEvent.Message("目录权限不可用，请到设置重新授权"))
            return null
        }
        return root
    }

    // 对齐 Rust: folder.full_name 以 "course files" 开头；根目录对应空子路径
    private fun resolveRelativeFolder(
        file: CanvasCourseFile,
        foldersMap: Map<Long, CanvasFolder>
    ): String? {
        val folderId = file.folderId ?: return null
        val fullName = foldersMap[folderId]?.fullName ?: return null
        if (fullName.length < 12) return null
        if (fullName == "course files") return ""
        if (!fullName.startsWith("course files/")) return null
        return fullName.substring(13)
    }

    private fun courseIdentifier(): String {
        val fallback = "course_$courseId"
        val identifier = _courseIdentifier.value
        if (!identifier.isNullOrBlank()) {
            return sanitizeFileName(identifier)
        }
        return fallback
    }

    private fun sanitizeFileName(value: String): String {
        return value
            .replace(Regex("[\\\\/:*?\"<>|]"), "_")
            .trim()
            .ifBlank { "course_$courseId" }
    }

    private fun ensureDirectory(parent: DocumentFile, relativePath: String): DocumentFile? {
        var current: DocumentFile? = parent
        if (relativePath.isBlank()) return current
        val parts = relativePath
            .replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotBlank() }

        for (part in parts) {
            val existing = current?.findFile(part)
            current = when {
                existing != null && existing.isDirectory -> existing
                existing == null -> current?.createDirectory(part)
                else -> return null
            }
        }
        return current
    }

    private fun findDirectory(parent: DocumentFile, relativePath: String): DocumentFile? {
        var current: DocumentFile? = parent
        if (relativePath.isBlank()) return current
        val parts = relativePath
            .replace('\\', '/')
            .split('/')
            .map { it.trim() }
            .filter { it.isNotBlank() }

        for (part in parts) {
            val existing = current?.findFile(part)
            if (existing == null || !existing.isDirectory) {
                return null
            }
            current = existing
        }
        return current
    }

    private fun writeBytesToFile(targetDir: DocumentFile, file: CanvasCourseFile, bytes: ByteArray): Boolean {
        val existing = targetDir.findFile(file.displayName)
        val target = when {
            existing != null && existing.isDirectory -> return false
            existing != null && existing.isFile -> existing
            else -> targetDir.createFile(file.contentType ?: "application/octet-stream", file.displayName)
        } ?: return false

        return runCatching {
            context.contentResolver.openOutputStream(target.uri, "w")?.use { os ->
                os.write(bytes)
            } ?: error("无法写入文件")
        }.isSuccess
    }

    private fun markProgressFinished(fileId: Long, processed: Long, total: Long) {
        val finishedProgress = DownloadProgress(
            processed = processed,
            total = total,
            finished = true
        )
        _downloadProgress.value = _downloadProgress.value + (fileId to finishedProgress)
        viewModelScope.launch {
            delay(1500)
            val current = _downloadProgress.value[fileId]
            if (current == finishedProgress) {
                _downloadProgress.value = _downloadProgress.value - fileId
            }
        }
    }
}
