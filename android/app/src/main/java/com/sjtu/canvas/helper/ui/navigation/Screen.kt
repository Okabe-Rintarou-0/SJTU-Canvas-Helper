package com.sjtu.canvas.helper.ui.navigation

sealed class Screen(val route: String) {
    object Login : Screen("login")
    object Courses : Screen("courses")
    object Assignments : Screen("assignments/{courseId}") {
        fun createRoute(courseId: Long) = "assignments/$courseId"
    }
    object Videos : Screen("videos/{courseId}") {
        fun createRoute(courseId: Long) = "videos/$courseId"
    }
    object Files : Screen("files/{courseId}") {
        fun createRoute(courseId: Long) = "files/$courseId"
    }
    object Settings : Screen("settings")
}
