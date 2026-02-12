package com.sjtu.canvas.helper.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.background
import androidx.hilt.navigation.compose.hiltViewModel
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.data.model.Course
import com.sjtu.canvas.helper.ui.viewmodel.CoursesUiState
import com.sjtu.canvas.helper.ui.viewmodel.CoursesViewModel
import java.time.OffsetDateTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CoursesScreen(
    onAssignmentsClick: (Long) -> Unit,
    onVideosClick: (Long) -> Unit,
    viewModel: CoursesViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.courses_title)) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    titleContentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
            )
        }
    ) { paddingValues ->
        when (val state = uiState) {
            is CoursesUiState.Loading -> {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(paddingValues),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }

            is CoursesUiState.Error -> {
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

            is CoursesUiState.Success -> {
                if (state.courses.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(stringResource(R.string.courses_empty))
                    }
                } else {
                    val groupedCourses = remember(state.courses) { groupCoursesByTimeline(state.courses) }
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(paddingValues),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        groupedCourses.forEach { section ->
                            item {
                                TimelineSectionHeader(title = section.title)
                            }
                            items(section.courses) { course ->
                                TimelineCourseItem {
                                    CourseCard(
                                        course = course,
                                        onAssignmentsClick = { onAssignmentsClick(course.id) },
                                        onVideosClick = { onVideosClick(course.id) }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseCard(
    course: Course,
    onAssignmentsClick: () -> Unit,
    onVideosClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(56.dp),
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Book,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = course.name?.takeIf { it.isNotBlank() } ?: "未命名课程",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = onAssignmentsClick) {
                    Icon(Icons.Default.Upload, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.nav_assignments))
                }
                Button(onClick = onVideosClick) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.nav_videos))
                }
            }
        }
    }
}

@Composable
private fun TimelineSectionHeader(title: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp, bottom = 4.dp)
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary
        )
        HorizontalDivider(modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun TimelineCourseItem(content: @Composable () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top
    ) {
        Column(
            modifier = Modifier
                .padding(end = 10.dp, top = 8.dp)
                .width(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(MaterialTheme.shapes.small)
                    .background(MaterialTheme.colorScheme.primary)
            )
            Box(
                modifier = Modifier
                    .padding(top = 4.dp)
                    .width(2.dp)
                    .height(80.dp)
                    .background(MaterialTheme.colorScheme.outlineVariant)
            )
        }
        Box(modifier = Modifier.weight(1f)) {
            content()
        }
    }
}

private data class CourseTimelineSection(
    val title: String,
    val courses: List<Course>
)

private fun groupCoursesByTimeline(courses: List<Course>): List<CourseTimelineSection> {
    val sorted = courses.sortedByDescending { courseTimestamp(it) }
    val groups = linkedMapOf<String, MutableList<Course>>()
    for (course in sorted) {
        val key = timelineKey(course)
        groups.getOrPut(key) { mutableListOf() }.add(course)
    }
    return groups.map { CourseTimelineSection(it.key, it.value) }
}

private fun timelineKey(course: Course): String {
    val termName = course.term?.name?.trim().orEmpty()
    if (termName.isNotBlank()) return termName
    val date = course.term?.startAt ?: course.startAt ?: course.term?.endAt ?: course.endAt
    val year = date?.take(4) ?: "未知年份"
    return "$year 学年"
}

private fun courseTimestamp(course: Course): Long {
    val date = course.term?.startAt ?: course.startAt ?: course.term?.endAt ?: course.endAt
    return parseTimestamp(date)
}

private fun parseTimestamp(value: String?): Long {
    if (value.isNullOrBlank()) return Long.MIN_VALUE
    return runCatching {
        OffsetDateTime.parse(value).toEpochSecond()
    }.getOrDefault(Long.MIN_VALUE)
}
