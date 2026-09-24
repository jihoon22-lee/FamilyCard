package com.familycard.collector.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.settings.AppSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date
import java.util.UUID

private data class CollectionStatus(
    val pending: Int,
    val rejected: Int,
    val summary: String,
    val captureError: String,
    val attemptedAt: Long,
    val uploadedAt: Long,
    val workId: String,
)

@Composable
fun CollectionStatusSection() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showRejected by remember { mutableStateOf(false) }
    var requesting by remember { mutableStateOf(false) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val settings = remember { AppSettings(context) }
    val queue = remember { QueueDatabase.getInstance(context) }
    val manager = remember { WorkManager.getInstance(context) }
    var status by remember { mutableStateOf<CollectionStatus?>(null) }
    var readError by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var requestedId by remember { mutableStateOf<String?>(null) }

    // 화면이 보일 때만 원문 없는 건수/상태를 갱신한다. 화면을 나갔다 올 필요가 없다.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                try {
                    status = withContext(Dispatchers.IO) {
                        CollectionStatus(queue.pendingCount(), queue.rejectedCount(), settings.lastUploadSummary,
                            settings.lastCaptureError, settings.lastUploadAttemptAt, settings.lastUploadAt,
                            settings.lastUploadWorkId)
                    }
                    readError = false
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    readError = true // 읽기 실패를 대기 0건으로 오인시키지 않는다.
                }
                delay(1_000)
            }
        }
    }
    val id = status?.workId?.takeIf { it.isNotBlank() } ?: requestedId
    val workFlow = remember(id) {
        id?.let { runCatching { UUID.fromString(it) }.getOrNull() }?.let(manager::getWorkInfoByIdFlow)
            ?: flowOf(null)
    }
    val work by workFlow.collectAsState(initial = null)
    val formatter = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.MEDIUM) }

    if (showRejected) RejectedMessagesDialog(onDismiss = { showRejected = false })

    SectionCard("수집 상태") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            status?.let {
                Text("대기 중 ${it.pending}건 · 확인 필요 ${it.rejected}건")
                if (it.captureError.isNotBlank()) Text(it.captureError)
                Text("마지막 전송 결과: ${it.summary.ifBlank { "아직 없음" }}")
                if (it.attemptedAt > 0) Text("마지막 전송 시도: ${formatter.format(Date(it.attemptedAt))}")
                if (it.uploadedAt > 0) Text("마지막 응답 반영: ${formatter.format(Date(it.uploadedAt))}")
            } ?: Text("전송 상태 확인 중…")
            if (readError) Text("전송 대기열 상태를 읽지 못했습니다. 저장 공간을 확인해주세요.")
            work?.let {
                val state = when (it.state) {
                    WorkInfo.State.ENQUEUED -> if (it.runAttemptCount > 0) "자동 재시도 대기 중" else "전송 작업 실행 대기 중"
                    WorkInfo.State.BLOCKED -> "이전 작업 대기 중 — 지금 전송으로 다시 예약할 수 있습니다."
                    WorkInfo.State.RUNNING -> "전송 작업 실행 중"
                    WorkInfo.State.FAILED -> "전송 작업 실패 — 결과를 확인한 뒤 다시 시도해주세요."
                    WorkInfo.State.CANCELLED -> "전송 작업 중지됨 — 원문은 대기열에 유지됩니다."
                    WorkInfo.State.SUCCEEDED -> "전송 작업 종료 — 위 결과를 확인해주세요."
                }
                Text(state)
            }
            Button(onClick = {
                requesting = true
                scope.launch {
                    try {
                        requestedId = UploadWorker.retryNow(context).toString()
                        status = status?.copy(workId = requestedId.orEmpty())
                        notice = "전송을 새로 예약했습니다. 위 결과가 갱신될 때까지 잠시 기다려주세요."
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        notice = "전송을 예약하지 못했습니다. 대기 원문은 유지됩니다."
                    } finally {
                        requesting = false
                    }
                }
            }, enabled = !requesting && work?.state != WorkInfo.State.RUNNING) { Text("지금 전송") }
            Button(onClick = { showRejected = true }) { Text("확인 필요 원문 보기") }
            notice?.let { Text(it) }
            Text("과거 문자 가져오기는 폰의 전송 대기열에 저장합니다. 서버 도착 여부는 전송 결과에서 확인하세요.")
        }
    }
}
