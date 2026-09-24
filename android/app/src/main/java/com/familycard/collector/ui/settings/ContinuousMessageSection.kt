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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.familycard.collector.history.RcsAutoWorker
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.RcsAutoSettings
import com.familycard.collector.settings.RcsAutoState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

@Composable
fun ContinuousMessageSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val settings = remember { AppSettings(context) }
    val auto = remember { RcsAutoSettings(context) }
    var state by remember { mutableStateOf<RcsAutoState?>(null) }
    var allText by remember { mutableStateOf(settings.captureAllRegisteredMessageText) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var readError by remember { mutableStateOf(false) }
    var confirmAllText by remember { mutableStateOf(false) }
    var permissionPending by remember { mutableStateOf(false) }
    var showPermissionSettings by remember { mutableStateOf(false) }
    val formatter = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM) }

    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                try {
                    state = withContext(Dispatchers.IO) { auto.load() }
                    allText = settings.captureAllRegisteredMessageText
                    if (state?.enabled == true) {
                        showPermissionSettings = context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED
                    }
                    readError = false
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    readError = true
                }
                delay(1_000)
            }
        }
    }

    fun changeAuto(enabled: Boolean) {
        busy = true
        scope.launch {
            try {
                RcsAutoWorker.configure(context.applicationContext, enabled)
                state = withContext(Dispatchers.IO) { auto.load() }
                notice = if (enabled) "RCS 자동 보충을 켰습니다." else "자동 보충을 껐습니다. 이미 보관한 원문은 유지됩니다."
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                notice = "자동 보충 설정을 완료하지 못했습니다. 문자 발신자 등록·읽기 권한·저장 공간을 확인해주세요."
            } finally {
                busy = false
            }
        }
    }

    fun changeAllText(enabled: Boolean) {
        busy = true
        scope.launch {
            try {
                withContext(Dispatchers.IO) { settings.captureAllRegisteredMessageText = enabled }
                allText = enabled
                notice = if (enabled) "등록 발신자의 새 문구도 보관합니다. 이전 기간은 과거 문자 가져오기로 보충할 수 있습니다."
                    else "앞으로는 기존 거래 어휘 필터를 적용합니다. 이미 보관한 원문은 유지됩니다."
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                notice = "문구 보관 설정을 저장하지 못했습니다."
            } finally {
                busy = false
            }
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val requested = permissionPending
        permissionPending = false
        if (requested && granted) {
            showPermissionSettings = false
            changeAuto(true)
        } else if (requested) {
            notice = "RCS 자동 보충에는 문자 읽기 권한이 필요합니다."
            showPermissionSettings = true
        }
    }

    SectionCard("새 문자 수집 보완") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("삼성 RCS 자동 보충: ${state?.let { if (it.enabled) "켜짐" else "꺼짐" } ?: "확인 중"}")
            Text("켜면 최근 하루부터 등록한 문자 발신자의 RCS를 약 15분 간격으로 확인합니다. 절전 상태에서는 늦어질 수 있습니다. 오래된 내역은 과거 문자 가져오기를 이용하세요.")
            Button(enabled = !busy && !permissionPending && state != null && !readError, onClick = {
                if (state?.enabled == true) changeAuto(false)
                else if (context.checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED) changeAuto(true)
                else {
                    permissionPending = true
                    permission.launch(Manifest.permission.READ_SMS)
                }
            }) { Text(if (state?.enabled == true) "자동 보충 끄기" else "자동 보충 켜기") }
            if (state?.enabled == true) {
                OutlinedButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            RcsAutoWorker.checkNow(context.applicationContext)
                            notice = "RCS 확인을 예약했습니다. 아래 결과가 갱신됩니다."
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            notice = "RCS 확인을 예약하지 못했습니다."
                        } finally {
                            busy = false
                        }
                    }
                }) { Text("RCS 지금 확인") }
            }
            state?.let {
                Text(it.summary)
                if (it.attemptedAt > 0) Text("최근 확인 시도: ${formatter.format(Date(it.attemptedAt))}")
                if (it.completedThrough > 0) Text("확인한 수신일: ${formatter.format(Date(it.completedThrough))}까지")
                if (it.warning.isNotBlank()) Text(it.warning)
            }
            Text("재확인한 원문도 전송 대기열에 들어갈 수 있으며 서버에서는 중복 저장하지 않습니다.")
            if (readError) Text("자동 보충 상태를 읽지 못했습니다. 저장 공간을 확인해주세요.")
            if (showPermissionSettings) TextButton(onClick = {
                context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
            }) { Text("문자 권한 설정 열기") }

            Text("등록 발신자의 모든 문구 보관: ${if (allText) "켜짐" else "꺼짐"}")
            Text("켜면 SMS·RCS의 새로운 문구를 거래 어휘와 관계없이 보관합니다. 등록 발신자의 광고·인증번호도 포함될 수 있습니다. 미등록 발신자는 수집하지 않습니다.")
            OutlinedButton(enabled = !busy, onClick = {
                if (allText) changeAllText(false) else confirmAllText = true
            }) { Text(if (allText) "거래 어휘 필터로 되돌리기" else "모든 문구 보관 설정") }
            notice?.let { Text(it) }
        }
    }
    if (confirmAllText) AlertDialog(
        onDismissRequest = { confirmAllText = false },
        title = { Text("등록 발신자의 모든 문구를 보관할까요?") },
        text = { Text("등록한 문자 발신자의 SMS·RCS 원문을 거래 어휘와 관계없이 서버에 보관합니다. 광고와 인증번호가 포함될 수 있습니다. 미등록 발신자는 제외하며, 이미 보관한 원문은 이 설정을 꺼도 삭제하지 않습니다.") },
        confirmButton = { TextButton(onClick = { confirmAllText = false; changeAllText(true) }) { Text("모든 문구 보관") } },
        dismissButton = { TextButton(onClick = { confirmAllText = false }) { Text("취소") } },
    )
}
