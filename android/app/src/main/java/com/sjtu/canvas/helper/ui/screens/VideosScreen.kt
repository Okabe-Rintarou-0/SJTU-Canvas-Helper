package com.sjtu.canvas.helper.ui.screens

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Splitscreen
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
//import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.data.model.CourseVideo
import com.sjtu.canvas.helper.data.model.VideoSubtitle
import com.sjtu.canvas.helper.ui.viewmodel.VideosUiState
import com.sjtu.canvas.helper.ui.viewmodel.VideosViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosScreen(
    courseId: Long,
    onNavigateBack: () -> Unit,
    viewModel: VideosViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val primaryVideo by viewModel.primaryVideo.collectAsState()
    val secondaryVideo by viewModel.secondaryVideo.collectAsState()
    var dualMode by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.videos_title)) },
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            when (val state = uiState) {
                is VideosUiState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                is VideosUiState.Error -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(state.message)
                            Spacer(modifier = Modifier.height(12.dp))
                            Button(onClick = { viewModel.loadVideos() }) {
                                Text(stringResource(R.string.retry))
                            }
                        }
                    }
                }

                is VideosUiState.Success -> {
                    if (primaryVideo != null) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(text = "同屏播放", style = MaterialTheme.typography.titleSmall)
                            Switch(checked = dualMode, onCheckedChange = { dualMode = it })
                        }

                        if (dualMode && secondaryVideo != null) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(300.dp)
                                    .padding(horizontal = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                VideoPlayerPane(
                                    video = primaryVideo!!,
                                    modifier = Modifier.weight(1f)
                                )
                                VideoPlayerPane(
                                    video = secondaryVideo!!,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        } else {
                            VideoPlayerPane(
                                video = primaryVideo!!,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(320.dp)
                                    .padding(horizontal = 8.dp)
                            )
                        }

                        HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                    }

                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(state.videos) { video ->
                            VideoCard(
                                video = video,
                                isPrimary = primaryVideo?.id == video.id,
                                isSecondary = secondaryVideo?.id == video.id,
                                onPrimarySelect = { viewModel.setPrimaryVideo(video) },
                                onSecondaryToggle = { viewModel.toggleSecondaryVideo(video) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun VideoCard(
    video: CourseVideo,
    isPrimary: Boolean,
    isSecondary: Boolean,
    onPrimarySelect: () -> Unit,
    onSecondaryToggle: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = if (isPrimary) 4.dp else 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isPrimary) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(48.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.primary
            ) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimary
                    )
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = video.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                video.duration?.let { duration ->
                    Text(
                        text = "${duration / 60} 分钟",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Column(horizontalAlignment = Alignment.End) {
                Button(onClick = onPrimarySelect) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(if (isPrimary) "主窗口" else "设为主窗口")
                }
                Spacer(modifier = Modifier.height(6.dp))
                FilledTonalButton(onClick = onSecondaryToggle) {
                    Icon(
                        imageVector = if (isSecondary) Icons.Default.Check else Icons.Default.Splitscreen,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(if (isSecondary) "取消同屏" else "加入同屏")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideoPlayerPane(
    video: CourseVideo,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var speed by remember(video.id) { mutableFloatStateOf(1.0f) }
    var subtitleEnabled by remember(video.id) { mutableStateOf(true) }
    var subtitle by remember(video.id) { mutableStateOf(video.subtitles.firstOrNull()) }

    val mediaItem = remember(video.url, subtitleEnabled, subtitle?.url) {
        val builder = MediaItem.Builder().setUri(video.url)
        if (subtitleEnabled && subtitle != null) {
            val subtitleConfig = MediaItem.SubtitleConfiguration.Builder(Uri.parse(subtitle!!.url))
                .setMimeType(subtitle!!.mimeType ?: MimeTypes.TEXT_VTT)
                .setLanguage(subtitle!!.language ?: "zh")
                .setLabel(subtitle!!.label)
                .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                .build()
            builder.setSubtitleConfigurations(listOf(subtitleConfig))
        }
        builder.build()
    }

    val player = remember(video.id, mediaItem) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(mediaItem)
            prepare()
            playWhenReady = true
        }
    }

    LaunchedEffect(speed) {
        player.playbackParameters = PlaybackParameters(speed)
    }

    LaunchedEffect(subtitleEnabled) {
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !subtitleEnabled)
            .build()
    }

    DisposableEffect(player) {
        onDispose { player.release() }
    }

    Column(modifier = modifier) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = true
                    this.player = player
                }
            },
            update = { it.player = player },
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("倍速", style = MaterialTheme.typography.bodySmall)
            listOf(0.5f, 1.0f, 1.25f, 1.5f, 2.0f).forEach { value ->
                FilterChip(
                    selected = speed == value,
                    onClick = { speed = value },
                    label = { Text("${value}x") }
                )
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("字幕", style = MaterialTheme.typography.bodySmall)
                Switch(
                    checked = subtitleEnabled,
                    onCheckedChange = { subtitleEnabled = it }
                )
            }

            if (video.subtitles.isNotEmpty()) {
                var expanded by remember(video.id) { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = !expanded }
                ) {
                    OutlinedTextField(
                        value = subtitle?.label ?: "字幕",
                        onValueChange = {},
                        readOnly = true,
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded)
                        },
                        modifier = Modifier
                            .menuAnchor()
                            .width(180.dp)
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        video.subtitles.forEach { option: VideoSubtitle ->
                            DropdownMenuItem(
                                text = { Text(option.label) },
                                onClick = {
                                    subtitle = option
                                    expanded = false
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
