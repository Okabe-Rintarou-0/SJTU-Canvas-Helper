package com.sjtu.canvas.helper.ui.screens

import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Splitscreen
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.data.model.SjtuCanvasVideo
import com.sjtu.canvas.helper.data.model.SjtuVideoPlayInfo
import com.sjtu.canvas.helper.ui.viewmodel.SjtuVideosUiState
import com.sjtu.canvas.helper.ui.viewmodel.SjtuVideosViewModel
import com.sjtu.canvas.helper.ui.viewmodel.VideoLoginState
import com.sjtu.canvas.helper.ui.viewmodel.VideoLoginViewModel
import com.sjtu.canvas.helper.util.QrCodeGenerator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VideosScreen(
    courseId: Long,
    onNavigateBack: () -> Unit,
    videosViewModel: SjtuVideosViewModel = hiltViewModel(),
    loginViewModel: VideoLoginViewModel = hiltViewModel()
) {
    val loginState by loginViewModel.state.collectAsState()
    val uiState by videosViewModel.uiState.collectAsState()
    val selectedVideo by videosViewModel.selectedVideo.collectAsState()
    val videoInfo by videosViewModel.videoInfo.collectAsState()
    val primaryPlay by videosViewModel.primaryPlay.collectAsState()
    val secondaryPlay by videosViewModel.secondaryPlay.collectAsState()
    val subtitlePath by videosViewModel.subtitlePath.collectAsState()

    var dualMode by remember { mutableStateOf(false) }

    LaunchedEffect(loginState) {
        if (loginState is VideoLoginState.LoggedIn) {
            videosViewModel.loadVideos()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.videos_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { videosViewModel.loadVideos() }) {
                        Icon(Icons.Default.Refresh, contentDescription = null)
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
            when (loginState) {
                is VideoLoginState.Idle,
                is VideoLoginState.ShowQr,
                is VideoLoginState.Loading,
                is VideoLoginState.Error -> {
                    VideoLoginPanel(
                        state = loginState,
                        onStart = { loginViewModel.startQrLogin() },
                        onCancel = { loginViewModel.cancel() }
                    )
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                }

                VideoLoginState.LoggedIn -> Unit
            }

            when (val state = uiState) {
                is SjtuVideosUiState.Loading -> {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }

                is SjtuVideosUiState.Error -> {
                    ErrorPanel(
                        message = state.message,
                        onRetry = { videosViewModel.loadVideos() }
                    )
                }

                is SjtuVideosUiState.Success -> {
                    if (state.videos.isEmpty()) {
                        EmptyPanel(
                            hint = "暂无回放（可能未登录 SJTU 视频平台或该课程没有录像）",
                            onLogin = { loginViewModel.startQrLogin() },
                            onReload = { videosViewModel.loadVideos() }
                        )
                        return@Column
                    }

                    if (primaryPlay != null) {
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

                        if (dualMode && secondaryPlay != null) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(320.dp)
                                    .padding(horizontal = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                SjtuVideoPlayer(
                                    playUrl = primaryPlay!!.rtmpUrlHdv,
                                    subtitlePath = subtitlePath,
                                    modifier = Modifier.weight(1f)
                                )
                                SjtuVideoPlayer(
                                    playUrl = secondaryPlay!!.rtmpUrlHdv,
                                    subtitlePath = subtitlePath,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        } else {
                            SjtuVideoPlayer(
                                playUrl = primaryPlay!!.rtmpUrlHdv,
                                subtitlePath = subtitlePath,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(360.dp)
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
                            CanvasVideoCard(
                                video = video,
                                selected = selectedVideo?.videoId == video.videoId,
                                onSelect = { videosViewModel.selectVideo(video) }
                            )
                        }

                        item {
                            if (videoInfo != null) {
                                HorizontalDivider(modifier = Modifier.padding(vertical = 12.dp))
                                Text(
                                    text = "播放源",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                videoInfo!!.videoPlayResponseVoList.forEach { play ->
                                    PlaySourceRow(
                                        play = play,
                                        isPrimary = primaryPlay?.id == play.id,
                                        isSecondary = secondaryPlay?.id == play.id,
                                        onPrimary = { videosViewModel.setPrimary(play) },
                                        onSecondary = { videosViewModel.toggleSecondary(play) }
                                    )
                                    Spacer(modifier = Modifier.height(8.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VideoLoginPanel(
    state: VideoLoginState,
    onStart: () -> Unit,
    onCancel: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "SJTU 视频回放需要 JAccount 会话",
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "请用另一台设备或电脑扫描二维码登录（与桌面版一致）。登录成功后会自动刷新回放列表。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            when (state) {
                is VideoLoginState.ShowQr -> {
                    Spacer(modifier = Modifier.height(12.dp))
                    val img = remember(state.qrUrl) { QrCodeGenerator.generate(state.qrUrl) }
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Image(bitmap = img, contentDescription = null, modifier = Modifier.size(220.dp))
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilledTonalButton(onClick = onCancel) {
                            Text("取消")
                        }
                    }
                }

                is VideoLoginState.Loading -> {
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(10.dp))
                        Text("正在获取二维码/等待扫码…")
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    FilledTonalButton(onClick = onCancel) {
                        Text("取消")
                    }
                }

                is VideoLoginState.Error -> {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = state.message,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onStart) { Text("重试") }
                        FilledTonalButton(onClick = onCancel) { Text("取消") }
                    }
                }

                VideoLoginState.Idle -> {
                    Spacer(modifier = Modifier.height(12.dp))
                    Button(onClick = onStart) { Text("扫码登录") }
                }

                VideoLoginState.LoggedIn -> Unit
            }
        }
    }
}

@Composable
private fun ErrorPanel(message: String, onRetry: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(message)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = onRetry) {
                Text(stringResource(R.string.retry))
            }
        }
    }
}

@Composable
private fun EmptyPanel(hint: String, onLogin: () -> Unit, onReload: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(hint, modifier = Modifier.padding(horizontal = 24.dp))
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onReload) { Text("刷新") }
                FilledTonalButton(onClick = onLogin) { Text("扫码登录") }
            }
        }
    }
}

@Composable
private fun CanvasVideoCard(
    video: SjtuCanvasVideo,
    selected: Boolean,
    onSelect: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface
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
                    Icon(Icons.Default.PlayArrow, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(video.videoName, style = MaterialTheme.typography.titleMedium)
                val time = listOfNotNull(video.courseBeginTime, video.courseEndTime)
                    .joinToString(" - ")
                if (time.isNotBlank()) {
                    Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Button(onClick = onSelect) {
                Text(if (selected) "已选择" else "选择")
            }
        }
    }
}

@Composable
private fun PlaySourceRow(
    play: SjtuVideoPlayInfo,
    isPrimary: Boolean,
    isSecondary: Boolean,
    onPrimary: () -> Unit,
    onSecondary: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = "源 #${play.id}")
                Text(
                    text = play.rtmpUrlHdv.take(64) + if (play.rtmpUrlHdv.length > 64) "…" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Column(horizontalAlignment = Alignment.End) {
                Button(onClick = onPrimary) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(if (isPrimary) "主" else "设主")
                }
                Spacer(modifier = Modifier.height(6.dp))
                FilledTonalButton(onClick = onSecondary) {
                    Icon(
                        imageVector = if (isSecondary) Icons.Default.Check else Icons.Default.Splitscreen,
                        contentDescription = null
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(if (isSecondary) "同屏" else "加入")
                }
            }
        }
    }
}

@Composable
private fun SjtuVideoPlayer(
    playUrl: String,
    subtitlePath: String?,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var speed by remember(playUrl) { mutableFloatStateOf(1.0f) }
    var subtitleEnabled by remember(playUrl) { mutableStateOf(true) }

    val httpFactory = remember {
        DefaultHttpDataSource.Factory().setDefaultRequestProperties(
            mapOf(
                "Referer" to "https://courses.sjtu.edu.cn",
                "User-Agent" to "Mozilla/5.0"
            )
        )
    }

    val mediaSourceFactory = remember { DefaultMediaSourceFactory(httpFactory) }

    val mediaItem = remember(playUrl, subtitlePath, subtitleEnabled) {
        val builder = MediaItem.Builder().setUri(playUrl)
        if (subtitleEnabled && !subtitlePath.isNullOrBlank()) {
            builder.setSubtitleConfigurations(
                listOf(
                    MediaItem.SubtitleConfiguration.Builder(
                        android.net.Uri.fromFile(java.io.File(subtitlePath))
                    )
                        .setMimeType(MimeTypes.TEXT_VTT)
                        .setLanguage("zh")
                        .setLabel("字幕")
                        .build()
                )
            )
        }
        builder.build()
    }

    val player = remember(playUrl, mediaItem) {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(mediaSourceFactory)
            .build().apply {
                setMediaItem(mediaItem)
                prepare()
                playWhenReady = true
            }
    }

    LaunchedEffect(speed) {
        player.playbackParameters = PlaybackParameters(speed)
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
            Text("字幕", style = MaterialTheme.typography.bodySmall)
            Switch(
                checked = subtitleEnabled,
                onCheckedChange = { subtitleEnabled = it },
                enabled = !subtitlePath.isNullOrBlank()
            )
        }
    }
}
