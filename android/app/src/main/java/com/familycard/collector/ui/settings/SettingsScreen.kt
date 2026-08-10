package com.familycard.collector.ui.settings

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.settings.AppSettings

/**
 * 설정 탭 — WebView 로 할 수 없는 것만 여기 둔다.
 *
 * 권한 상태 3종을 항상 노출하는 이유: 이 앱의 가장 위험한 실패 모드는 **조용히
 * 멈추는 것**이다. 알림 권한이 꺼지거나 배터리 최적화에 걸리면 아무 소리 없이
 * 데이터가 안 올라간다. 사용자는 "이번 달엔 카드를 안 썼나 보다"라고 생각하게
 * 된다.
 */
@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val settings = remember { AppSettings(context) }

    var serverUrl by remember { mutableStateOf(settings.serverUrl) }
    var deviceToken by remember { mutableStateOf(settings.deviceToken) }
    var saved by remember { mutableStateOf(false) }
    var pendingCount by remember { mutableStateOf(runCatching { QueueDatabase(context).pendingCount() }.getOrDefault(0)) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard("서버 연결") {
            OutlinedTextField(
                value = serverUrl,
                onValueChange = { serverUrl = it; saved = false },
                label = { Text("서버 주소") },
                placeholder = { Text("https://familycard.example.ts.net") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = deviceToken,
                onValueChange = { deviceToken = it; saved = false },
                label = { Text("기기 토큰") },
                placeholder = { Text("관리자에게 받은 토큰") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Button(
                onClick = {
                    settings.serverUrl = serverUrl
                    settings.deviceToken = deviceToken
                    saved = true
                },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("저장") }
            if (saved) {
                Text("저장했습니다. 대시보드 탭에서 확인하세요.", style = MaterialTheme.typography.bodySmall)
            }
        }

        SectionCard("권한 상태") {
            PermissionRow(
                label = "알림 접근",
                granted = isNotificationListenerEnabled(context),
                onOpen = { context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
            )
            PermissionRow(
                label = "문자 수신",
                granted = context.checkSelfPermission(android.Manifest.permission.RECEIVE_SMS) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED,
                onOpen = {
                    context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            .setData(android.net.Uri.fromParts("package", context.packageName, null)),
                    )
                },
            )
            PermissionRow(
                label = "배터리 최적화 예외",
                granted = isIgnoringBatteryOptimizations(context),
                onOpen = { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) },
            )
        }

        SectionCard("수집 상태") {
            Text("대기 중  ${pendingCount}건", style = MaterialTheme.typography.bodyMedium)
            Text(
                "마지막 전송  " + settings.lastUploadSummary.ifEmpty { "아직 없음" },
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
            Button(
                onClick = {
                    WorkManager.getInstance(context)
                        .enqueue(OneTimeWorkRequestBuilder<UploadWorker>().build())
                    pendingCount = runCatching { QueueDatabase(context).pendingCount() }.getOrDefault(0)
                },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("지금 전송") }
            // 전송 로그에 본문을 표시하지 않는다. 건수와 시각만.
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            content()
        }
    }
}

@Composable
private fun PermissionRow(label: String, granted: Boolean, onOpen: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("${if (granted) "✅" else "⚠️"}  $label", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onOpen) { Text("설정") }
    }
}

private fun isNotificationListenerEnabled(context: Context): Boolean {
    val manager = context.getSystemService(NotificationManager::class.java)
    return manager?.isNotificationListenerAccessGranted(
        android.content.ComponentName(
            context,
            com.familycard.collector.capture.CardNotificationListener::class.java,
        ),
    ) == true
}

private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    val power = context.getSystemService(PowerManager::class.java) ?: return false
    return power.isIgnoringBatteryOptimizations(context.packageName)
}
