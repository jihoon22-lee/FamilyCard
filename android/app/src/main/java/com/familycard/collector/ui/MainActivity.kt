package com.familycard.collector.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.familycard.collector.ui.dashboard.DashboardScreen
import com.familycard.collector.ui.settings.SettingsScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { AppScaffold() } }
    }
}

private enum class Tab(val label: String) { DASHBOARD("대시보드"), SETTINGS("설정") }

@Composable
private fun AppScaffold() {
    var current by remember { mutableStateOf(Tab.DASHBOARD) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab,
                        onClick = { current = tab },
                        icon = { Text(if (tab == Tab.DASHBOARD) "🏠" else "⚙️") },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        when (current) {
            Tab.DASHBOARD -> DashboardScreen(Modifier.padding(padding))
            Tab.SETTINGS -> SettingsScreen(Modifier.padding(padding))
        }
    }
}
