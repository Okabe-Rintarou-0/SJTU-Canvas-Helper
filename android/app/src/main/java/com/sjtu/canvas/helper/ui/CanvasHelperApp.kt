package com.sjtu.canvas.helper.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
//import androidx.compose.material3.windowsizeclass.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sjtu.canvas.helper.R
import com.sjtu.canvas.helper.ui.navigation.Screen
import com.sjtu.canvas.helper.ui.screens.*

data class NavigationItem(
    val route: String,
    val icon: ImageVector,
    val label: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CanvasHelperApp() {
    val navController = rememberNavController()
    val configuration = LocalConfiguration.current
    val screenWidthDp = configuration.screenWidthDp
    
    // Adaptive layout based on screen size
    val useNavigationRail = screenWidthDp >= 600 // Tablet
    
    val navigationItems = listOf(
        NavigationItem(
            route = Screen.Courses.route,
            icon = Icons.Default.Book,
            label = stringResource(R.string.nav_courses)
        ),
        NavigationItem(
            route = Screen.Settings.route,
            icon = Icons.Default.Settings,
            label = stringResource(R.string.nav_settings)
        )
    )
    
    Scaffold(
        bottomBar = {
            if (!useNavigationRail) {
                NavigationBar {
                    val navBackStackEntry by navController.currentBackStackEntryAsState()
                    val currentRoute = navBackStackEntry?.destination?.route
                    
                    navigationItems.forEach { item ->
                        NavigationBarItem(
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                            selected = currentRoute == item.route,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(Screen.Courses.route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        )
                    }
                }
            }
        }
    ) { paddingValues ->
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (useNavigationRail) {
                NavigationRail(
                    modifier = Modifier.fillMaxHeight()
                ) {
                    Spacer(Modifier.height(16.dp))
                    val navBackStackEntry by navController.currentBackStackEntryAsState()
                    val currentRoute = navBackStackEntry?.destination?.route
                    
                    navigationItems.forEach { item ->
                        NavigationRailItem(
                            icon = { Icon(item.icon, contentDescription = item.label) },
                            label = { Text(item.label) },
                            selected = currentRoute == item.route,
                            onClick = {
                                navController.navigate(item.route) {
                                    popUpTo(Screen.Courses.route) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        )
                    }
                }
            }
            
            AppNavHost(
                navController = navController,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

@Composable
fun AppNavHost(
    navController: NavHostController,
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Login.route,
        modifier = modifier
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Screen.Courses.route) {
                        popUpTo(Screen.Login.route) { inclusive = true }
                    }
                }
            )
        }
        
        composable(Screen.Courses.route) {
            CoursesScreen(
                onAssignmentsClick = { courseId ->
                    navController.navigate(Screen.Assignments.createRoute(courseId))
                },
                onVideosClick = { courseId ->
                    navController.navigate(Screen.Videos.createRoute(courseId))
                }
            )
        }
        
        composable(Screen.Assignments.route) { backStackEntry ->
            val courseId = backStackEntry.arguments?.getString("courseId")?.toLongOrNull() ?: 0L
            AssignmentsScreen(
                courseId = courseId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        composable(Screen.Videos.route) { backStackEntry ->
            val courseId = backStackEntry.arguments?.getString("courseId")?.toLongOrNull() ?: 0L
            VideosScreen(
                courseId = courseId,
                onNavigateBack = { navController.popBackStack() }
            )
        }
        
        composable(Screen.Settings.route) {
            SettingsScreen()
        }
    }
}
