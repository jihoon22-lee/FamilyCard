package com.familycard.collector.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.queue.RejectedMessageSummary
import com.familycard.collector.queue.UploadWorker
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

@Composable
fun RejectedMessagesDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val queue = remember { QueueDatabase.getInstance(context) }
    val scope = rememberCoroutineScope()
    val formatter = remember { DateFormat.getDateTimeInstance() }
    var pages by remember { mutableStateOf(listOf(Long.MAX_VALUE)) }
    var refresh by remember { mutableIntStateOf(0) }
    var rows by remember { mutableStateOf<List<RejectedMessageSummary>>(emptyList()) }
    var selected by remember { mutableStateOf<PendingMessage?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var notice by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(pages, refresh) {
        loading = true
        rows = emptyList()
        try {
            rows = withContext(Dispatchers.IO) { queue.rejectedPage(pages.last()) }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            notice = "격리함을 읽지 못했습니다. 원문은 삭제하지 않았습니다."
        } finally {
            loading = false
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("확인 필요 원문") },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("서버가 거부한 원문을 폰에 보관하고 있습니다. 앱·서버 문제를 해결한 뒤 재전송하세요. 재전송은 원문을 수정하지 않습니다.")
                notice?.let { Text(it) }
                val detail = selected
                if (detail != null) {
                    Text("수신 ${formatter.format(Date(detail.receivedAt))}")
                    Text(detail.packageName)
                    Text(detail.title)
                    Text(detail.body)
                    OutlinedButton(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            try {
                                val moved = withContext(Dispatchers.IO) { queue.retryRejected(detail.id) }
                                selected = null
                                refresh++
                                if (moved) {
                                    notice = "원문을 대기열로 옮겼습니다. 전송 결과는 수집 상태에서 확인하세요."
                                    try {
                                        UploadWorker.retryNow(context)
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (_: Exception) {
                                        notice = "대기열에 보존했습니다. 즉시 예약에 실패했으므로 지금 전송을 다시 누르거나 자동 전송을 기다리세요."
                                    }
                                } else notice = "이미 처리된 항목입니다. 목록을 새로 확인하세요."
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                notice = "대기열로 옮기지 못했습니다. 격리 원문은 유지됩니다."
                            } finally {
                                busy = false
                            }
                        }
                    }) { Text("이 원문 재전송") }
                    TextButton(enabled = !busy, onClick = { selected = null }) { Text("목록으로") }
                } else {
                    if (loading) Text("불러오는 중…")
                    else if (rows.isEmpty()) Text("이 페이지에 확인할 항목이 없습니다.")
                    rows.forEach { row ->
                        HorizontalDivider()
                        Text("${row.source} · 수신 ${formatter.format(Date(row.receivedAt))}")
                        Text("거부 ${formatter.format(Date(row.rejectedAt))}")
                        Text(rejectionDescription(row.reason))
                        TextButton(enabled = !busy && !loading, onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    selected = withContext(Dispatchers.IO) { queue.rejectedMessage(row.id) }
                                    notice = if (selected == null) "이미 처리된 항목입니다." else null
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (_: Exception) {
                                    notice = "원문을 읽지 못했습니다. 원문은 삭제하지 않았습니다."
                                } finally { busy = false }
                            }
                        }) { Text("원문 확인") }
                    }
                    Row {
                        TextButton(enabled = !loading && !busy && pages.size > 1,
                            onClick = { pages = pages.dropLast(1) }) { Text("이전") }
                        TextButton(enabled = !loading && !busy && rows.size == 20,
                            onClick = { pages = pages + rows.last().id }) { Text("다음") }
                        TextButton(enabled = !loading && !busy,
                            onClick = { pages = listOf(Long.MAX_VALUE); refresh++ }) { Text("새로고침") }
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("닫기") } },
    )
}

/** 서버 오류 문자열을 그대로 노출하지 않는다. */
internal fun rejectionDescription(reason: String): String = when (reason) {
    "received_at_in_future" -> "수신 시각이 미래입니다. 휴대폰과 서버 시각을 확인하세요."
    "received_at_too_old" -> "수신 시각이 서버 허용 기간보다 오래됐습니다."
    "body_too_long", "title_too_long" -> "원문 길이가 서버 허용 범위를 넘었습니다. 앱·서버 지원 범위를 확인하세요."
    "empty_body", "invalid_body", "invalid_title" -> "서버가 원문 형식을 처리하지 못했습니다. 앱·서버 개선이 필요합니다."
    else -> "서버 수집 규격과 맞지 않는 항목입니다. 앱·서버 지원 범위를 확인하세요."
}
