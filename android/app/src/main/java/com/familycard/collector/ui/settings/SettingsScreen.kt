package com.familycard.collector.ui.settings

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import com.familycard.collector.BuildConfig
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.ServerUrlPolicy

/** WebView로 할 수 없는 서버 연결·권한·수집 상태를 관리하는 설정 탭. */
@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val settings = remember { AppSettings(context) }
    val queue = remember { QueueDatabase.getInstance(context) }

    var serverUrl by remember { mutableStateOf(settings.serverUrl) }
    var deviceToken by remember { mutableStateOf(settings.deviceToken) }
    var saved by remember { mutableStateOf(false) }
    var saveError by remember { mutableStateOf<String?>(null) }
    var permissionRefresh by remember { mutableIntStateOf(0) }
    var pendingCount by remember { mutableIntStateOf(runCatching { queue.pendingCount() }.getOrDefault(0)) }
    var rejectedCount by remember { mutableIntStateOf(runCatching { queue.rejectedCount() }.getOrDefault(0)) }

    val notificationSettings = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { permissionRefresh++ }
    val smsPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { permissionRefresh++ }
    val batterySettings = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { permissionRefresh++ }

    val notificationGranted = remember(permissionRefresh) { isNotificationListenerEnabled(context) }
    val smsGranted = remember(permissionRefresh) {
        context.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    }
    val batteryGranted = remember(permissionRefresh) { isIgnoringBatteryOptimizations(context) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        SectionCard("서버 연결") {
            OutlinedTextField(
                value = serverUrl,
                onValueChange = {
                    serverUrl = it
                    saved = false
                    saveError = null
                },
                label = { Text("서버 주소") },
                placeholder = { Text("https://familycard.example.ts.net") },
                supportingText = { Text("운영 앱은 경로 없는 HTTPS 주소만 허용합니다.") },
                isError = saveError != null,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = deviceToken,
                onValueChange = {
                    deviceToken = it
                    saved = false
                    saveError = null
                },
                label = { Text("기기 토큰") },
                placeholder = { Text("관리자에게 받은 토큰") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Button(
                onClick = {
                    val normalizedUrl = ServerUrlPolicy.normalize(serverUrl, BuildConfig.DEBUG)
                    when {
                        normalizedUrl == null -> {
                            saved = false
                            saveError = "서버 주소를 확인해주세요. 운영 앱은 HTTPS만 허용합니다."
                        }

                        deviceToken.isBlank() -> {
                            saved = false
                            saveError = "기기 토큰을 입력해주세요."
                        }

                        else -> {
                            settings.serverUrl = normalizedUrl
                            settings.deviceToken = deviceToken
                            serverUrl = normalizedUrl
                            saved = true
                            saveError = null
                            UploadWorker.schedule(context)
                            UploadWorker.scheduleImmediate(context)
                        }
                    }
                },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("저장") }
            saveError?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            if (saved) {
                Text(
                    "저장했습니다. 대기 중인 원문 전송을 시작합니다.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        CaptureSourcesSection()

        SectionCard("권한 상태") {
            PermissionRow(
                label = "알림 접근",
                granted = notificationGranted,
                actionLabel = "설정",
                onOpen = {
                    notificationSettings.launch(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                },
            )
            PermissionRow(
                label = "문자 수신",
                granted = smsGranted,
                actionLabel = if (smsGranted) "확인" else "권한 요청",
                onOpen = { smsPermission.launch(Manifest.permission.RECEIVE_SMS) },
            )
            PermissionRow(
                label = "배터리 최적화 예외",
                granted = batteryGranted,
                actionLabel = "설정",
                onOpen = {
                    batterySettings.launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                },
            )
        }

        SectionCard("수집 상태") {
            Text("대기 중  ${pendingCount}건", style = MaterialTheme.typography.bodyMedium)
            Text(
                "확인 필요  ${rejectedCount}건",
                color = if (rejectedCount > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
            if (settings.lastCaptureError.isNotEmpty()) {
                Text(
                    settings.lastCaptureError,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Text(
                "마지막 전송  " + settings.lastUploadSummary.ifEmpty { "아직 없음" },
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp),
            )
            Button(
                onClick = {
                    UploadWorker.scheduleImmediate(context)
                    pendingCount = runCatching { queue.pendingCount() }.getOrDefault(0)
                    rejectedCount = runCatching { queue.rejectedCount() }.getOrDefault(0)
                },
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("지금 전송") }
            // 전송 상태에는 원문·제목을 표시하지 않는다. 건수와 상태만 노출한다.
        }
    }
}

@Composable
internal fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            content()
        }
    }
}

@Composable
private fun PermissionRow(
    label: String,
    granted: Boolean,
    actionLabel: String,
    onOpen: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("${if (granted) "✅" else "⚠️"}  $label", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(onClick = onOpen) { Text(actionLabel) }
    }
}

private fun isNotificationListenerEnabled(context: Context): Boolean =
    context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)

private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    val power = context.getSystemService(PowerManager::class.java) ?: return false
    return power.isIgnoringBatteryOptimizations(context.packageName)
}
