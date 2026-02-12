package com.sjtu.canvas.helper.ui.screens

import android.provider.OpenableColumns
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.data.model.Assignment
import com.sjtu.canvas.helper.ui.viewmodel.AssignmentsUiState
import com.sjtu.canvas.helper.ui.viewmodel.AssignmentsViewModel
import com.sjtu.canvas.helper.ui.viewmodel.UploadState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssignmentsScreen(
    courseId: Long,
    onNavigateBack: () -> Unit,
    viewModel: AssignmentsViewModel = hiltViewModel()
) {
    var showUploadDialog by remember { mutableStateOf(false) }
    var selectedAssignment by remember { mutableStateOf<Assignment?>(null) }
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val uploadState by viewModel.uploadState.collectAsState()

    LaunchedEffect(uploadState) {
        if (uploadState is UploadState.Success) {
            showUploadDialog = false
            selectedAssignment = null
            viewModel.resetUploadState()
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.assignments_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { paddingValues ->
        when (val state = uiState) {
            is AssignmentsUiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }

            is AssignmentsUiState.Error -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(state.message)
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(onClick = { viewModel.refresh() }) {
                            Text(stringResource(R.string.retry))
                        }
                    }
                }
            }

            is AssignmentsUiState.Success -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(state.assignments) { assignment ->
                        AssignmentCard(
                            assignment = assignment,
                            onUploadClick = {
                                selectedAssignment = assignment
                                showUploadDialog = true
                            }
                        )
                    }
                }
            }
        }
    }
    
    if (showUploadDialog && selectedAssignment != null) {
        UploadDialog(
            assignment = selectedAssignment!!,
            onDismiss = {
                showUploadDialog = false
                selectedAssignment = null
                viewModel.resetUploadState()
            },
            onUpload = { uri ->
                val fileBytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (fileBytes == null) {
                    viewModel.resetUploadState()
                    return@UploadDialog
                }
                val fileName = context.resolveFileName(uri)
                val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                viewModel.uploadAssignment(
                    assignmentId = selectedAssignment!!.id,
                    fileName = fileName,
                    fileBytes = fileBytes,
                    mimeType = mimeType
                )
            }
        )
    }

    if (uploadState is UploadState.Uploading) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    }

    if (uploadState is UploadState.Error) {
        val message = (uploadState as UploadState.Error).message
        AlertDialog(
            onDismissRequest = { viewModel.resetUploadState() },
            title = { Text(stringResource(R.string.error)) },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { viewModel.resetUploadState() }) {
                    Text(stringResource(R.string.ok))
                }
            }
        )
    }
}

private fun android.content.Context.resolveFileName(uri: Uri): String {
    contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (nameIndex >= 0 && cursor.moveToFirst()) {
            return cursor.getString(nameIndex)
        }
    }
    return uri.lastPathSegment ?: "upload_file"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssignmentCard(
    assignment: Assignment,
    onUploadClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = assignment.name?.takeIf { it.isNotBlank() } ?: "未命名作业",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            
            Spacer(modifier = Modifier.height(8.dp))
            
            assignment.description?.let { desc ->
                Text(
                    text = desc,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    assignment.dueAt?.let { dueDate ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                Icons.Default.Schedule,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = dueDate.substring(0, 10), // Simple date formatting
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                
                Button(
                    onClick = onUploadClick,
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    Icon(
                        Icons.Default.Upload,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.assignments_upload))
                }
            }
        }
    }
}

@Composable
fun UploadDialog(
    assignment: Assignment,
    onDismiss: () -> Unit,
    onUpload: (Uri) -> Unit
) {
    var selectedFileUri by remember { mutableStateOf<Uri?>(null) }
    
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedFileUri = uri
    }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.assignments_upload)) },
        text = {
            Column {
                Text("作业: ${assignment.name?.takeIf { it.isNotBlank() } ?: "未命名作业"}")
                Spacer(modifier = Modifier.height(16.dp))
                
                Button(
                    onClick = { launcher.launch("*/*") },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.AttachFile, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(selectedFileUri?.lastPathSegment ?: "选择文件")
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    selectedFileUri?.let { onUpload(it) }
                },
                enabled = selectedFileUri != null
            ) {
                Text(stringResource(R.string.ok))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
