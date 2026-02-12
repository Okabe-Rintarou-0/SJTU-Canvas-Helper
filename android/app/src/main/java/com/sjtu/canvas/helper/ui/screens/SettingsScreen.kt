package com.sjtu.canvas.helper.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.ui.viewmodel.SettingsViewModel
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen() {
    var showTokenDialog by remember { mutableStateOf(false) }
    var selectedTheme by remember { mutableStateOf("system") }
    val viewModel: SettingsViewModel = hiltViewModel()
    val courseFilesTreeUri by viewModel.courseFilesTreeUri.collectAsState()
    val context = LocalContext.current

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri != null) {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, flags)
            }
            viewModel.saveCourseFilesTreeUri(uri)
        }
    }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
        ) {
            // Account Section
            SettingsSection(title = "账户") {
                SettingsItem(
                    icon = Icons.Default.Key,
                    title = stringResource(R.string.settings_token),
                    subtitle = "点击修改 Canvas Token",
                    onClick = { showTokenDialog = true }
                )
                
                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
                
                SettingsItem(
                    icon = Icons.Default.Logout,
                    title = stringResource(R.string.settings_logout),
                    subtitle = "退出当前账户",
                    onClick = { /* TODO: Implement logout */ }
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            // Appearance Section
            SettingsSection(title = "外观") {
                SettingsItem(
                    icon = Icons.Default.Palette,
                    title = stringResource(R.string.settings_theme),
                    subtitle = when (selectedTheme) {
                        "light" -> stringResource(R.string.settings_theme_light)
                        "dark" -> stringResource(R.string.settings_theme_dark)
                        else -> stringResource(R.string.settings_theme_system)
                    },
                    onClick = { /* TODO: Show theme selector */ }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            SettingsSection(title = "文件") {
                SettingsItem(
                    icon = Icons.Default.Folder,
                    title = "课程文件存储位置",
                    subtitle = courseFilesTreeUri ?: "未设置（点击选择目录）",
                    onClick = { launcher.launch(null) }
                )

                HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

                SettingsItem(
                    icon = Icons.Default.Delete,
                    title = "清除文件夹授权",
                    subtitle = "清除已保存的课程文件目录授权",
                    onClick = { viewModel.clearCourseFilesTreeUri() }
                )
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            // About Section
            SettingsSection(title = "关于") {
                SettingsItem(
                    icon = Icons.Default.Info,
                    title = "版本",
                    subtitle = "1.0.0",
                    onClick = { }
                )
            }
        }
    }
    
    if (showTokenDialog) {
        TokenDialog(
            onDismiss = { showTokenDialog = false },
            onSave = { token ->
                // TODO: Save token
                showTokenDialog = false
            }
        )
    }
}

@Composable
fun SettingsSection(
    title: String,
    content: @Composable () -> Unit
) {
    Column {
        Text(
            text = title,
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )
        
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            content()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsItem(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        leadingContent = {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        modifier = Modifier.clickable(onClick = onClick)
    )
}

@Composable
fun TokenDialog(
    onDismiss: () -> Unit,
    onSave: (String) -> Unit
) {
    var token by remember { mutableStateOf("") }
    
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.settings_token)) },
        text = {
            OutlinedTextField(
                value = token,
                onValueChange = { token = it },
                label = { Text("Canvas Token") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(token) },
                enabled = token.isNotBlank()
            ) {
                Text(stringResource(R.string.save))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
