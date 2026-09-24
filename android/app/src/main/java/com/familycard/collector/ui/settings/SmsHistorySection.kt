package com.familycard.collector.ui.settings

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.history.SmsHistoryRange
import com.familycard.collector.history.SmsHistoryWorker
import com.familycard.collector.settings.CaptureSourceStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

@Composable
fun SmsHistorySection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val manager = remember { WorkManager.getInstance(context) }
    var workId by remember { mutableStateOf(SmsHistoryWorker.lastWorkId(context)) }
    val workFlow = remember(workId) { workId?.let(manager::getWorkInfoByIdFlow) ?: flowOf(null) }
    val work by workFlow.collectAsState(initial = null)
    var scheduling by remember { mutableStateOf(false) }
    var dialogOpen by rememberSaveable { mutableStateOf(false) }
    var days by rememberSaveable { mutableStateOf(90) }
    var permissionDays by rememberSaveable { mutableStateOf<Int?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var showPermissionSettings by remember { mutableStateOf(false) }
    val busy = scheduling || permissionDays != null || work?.state?.isFinished == false

    fun startImport(selectedDays: Int) {
        scheduling = true
        notice = null
        showPermissionSettings = false
        scope.launch {
            try {
                workId = SmsHistoryWorker.start(context.applicationContext, selectedDays)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                notice = "가져오기를 시작하지 못했습니다. SMS 발신자 등록과 저장 공간을 확인해주세요."
            } finally {
                scheduling = false
            }
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val requested = permissionDays
        permissionDays = null
        if (granted && requested != null) {
            showPermissionSettings = false
            startImport(requested)
        } else {
            notice = "과거 SMS를 가져오려면 문자 읽기 권한이 필요합니다. 허용되지 않으면 가져오지 않습니다."
            showPermissionSettings = true
        }
    }

    SectionCard("과거 문자 가져오기") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("등록한 문자 발신자의 SMS와 삼성 메시지 RCS(채팅+)를 가져옵니다. 기본은 거래 어휘가 있는 문자를 보관하며, 아래 ‘모든 문구 보관’을 켜면 새 형식도 보관합니다. 카카오톡·MMS는 포함하지 않습니다.")
            Button(
                enabled = !busy,
                onClick = {
                    val senders = CaptureSourceStore(context).load().filter { it.kind == CaptureOriginKind.SMS_SENDER }
                    if (senders.isEmpty()) notice = "먼저 수집 대상에 SMS 발신자를 등록해주세요."
                    else dialogOpen = true
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "가져오는 중…" else "기간 선택 후 가져오기") }
            work?.let { info ->
                val data = if (info.state.isFinished) info.outputData else info.progress
                val message = when (info.state) {
                    WorkInfo.State.CANCELLED -> "가져오기를 중지했습니다. 이미 저장한 문자는 계속 전송됩니다."
                    WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> "가져오기 대기 중입니다."
                    else -> data.getString(SmsHistoryWorker.SUMMARY) ?: "문자를 확인하고 있습니다."
                }
                Text(message)
                if (info.state == WorkInfo.State.RUNNING || info.state == WorkInfo.State.SUCCEEDED || info.state == WorkInfo.State.FAILED) {
                    val total = data.getInt(SmsHistoryWorker.QUEUED, 0)
                    val rcs = data.getInt(SmsHistoryWorker.RCS_QUEUED, 0)
                    Text("큐에 저장 SMS ${total - rcs}건 · RCS ${rcs}건 · 이미 대기 중 ${data.getInt(SmsHistoryWorker.ALREADY_QUEUED, 0)}건")
                    data.getString(SmsHistoryWorker.RCS_SUMMARY)?.takeIf { it.isNotBlank() }?.let { Text(it) }
                    val oversized = data.getInt(SmsHistoryWorker.OVERSIZED, 0)
                    if (oversized > 0) Text("본문이 너무 긴 RCS $oversized 건은 제외했습니다. 원본은 문자 앱에 남아 있습니다.")
                    val missing = data.getInt(SmsHistoryWorker.MISSING_TIMESTAMP, 0)
                    if (missing > 0) Text("시각 정보가 없거나 잘못된 $missing 건은 중복 여부를 확인할 수 없어 제외했습니다.")
                }
                if (!info.state.isFinished) {
                    OutlinedButton(onClick = { manager.cancelWorkById(info.id) }) { Text("가져오기 중지") }
                }
            }
            Text("이미 서버에 있는 같은 문자는 다시 저장되지 않습니다. 전송 결과는 수집 상태에서 확인하세요.")
            notice?.let { Text(it) }
            if (showPermissionSettings) {
                OutlinedButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
                }) { Text("앱 권한 설정 열기") }
            }
        }
    }

    if (dialogOpen) {
        AlertDialog(
            onDismissRequest = { dialogOpen = false },
            title = { Text("과거 SMS·RCS 가져오기") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("선택한 기간의 등록 발신자 문자만 FamilyCard 서버에 원문으로 보관합니다. 휴대폰의 문자는 변경하거나 삭제하지 않습니다.")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SmsHistoryRange.dayOptions.forEach { option ->
                            FilterChip(selected = days == option, onClick = { days = option }, label = { Text("${option}일") })
                        }
                    }
                    Text("처음 실행할 때 문자 읽기 권한을 요청합니다.")
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    dialogOpen = false
                    if (context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED) {
                        startImport(days)
                    } else {
                        permissionDays = days
                        permission.launch(Manifest.permission.READ_SMS)
                    }
                }) { Text("가져오기") }
            },
            dismissButton = { TextButton(onClick = { dialogOpen = false }) { Text("취소") } },
        )
    }
}
