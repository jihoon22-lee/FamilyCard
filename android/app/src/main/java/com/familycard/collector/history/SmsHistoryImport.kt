package com.familycard.collector.history

import com.familycard.collector.capture.CaptureEventId
import com.familycard.collector.capture.CaptureFilter
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueEnqueueResult
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit

/** 본문 없이 읽는 SMS 보관함 메타데이터. 미등록 발신자는 이 단계에서 탈락한다. */
data class SmsHistoryEntry(
    val id: Long,
    val sender: String?,
    val receivedAt: Long,
    val sentAt: Long,
)

data class SmsHistoryRange(val from: Long, val through: Long) {
    init {
        require(from > 0 && through >= from)
    }

    // 서버 수집 계약과 같은 5년 하한. 지연 수신 SMS의 발신 시각을 현재로 바꾸지 않는다.
    val oldestSupportedTimestamp: Long = Instant.ofEpochMilli(through).atZone(ZoneOffset.UTC)
        .minusYears(5).toInstant().toEpochMilli()

    companion object {
        val dayOptions = listOf(30, 90, 365)

        fun recent(days: Int, now: Long): SmsHistoryRange {
            require(days in dayOptions)
            return SmsHistoryRange(now - TimeUnit.DAYS.toMillis(days.toLong()), now)
        }
    }
}

enum class SmsHistoryOutcome { QUEUED, ALREADY_QUEUED, SKIPPED, MISSING_TIMESTAMP }

/** Android I/O를 콜백으로 분리해 본문 접근 전 필터와 멱등성을 검증한다. */
object SmsHistoryImport {
    fun copyOne(
        entry: SmsHistoryEntry,
        range: SmsHistoryRange,
        approvedSenders: Set<String>,
        currentSources: () -> List<CaptureSourceConfig>,
        readBody: () -> String?,
        enqueue: (PendingMessage) -> QueueEnqueueResult,
    ): SmsHistoryOutcome {
        if (entry.receivedAt !in range.from..range.through) return SmsHistoryOutcome.SKIPPED
        val sender = entry.sender ?: return SmsHistoryOutcome.SKIPPED
        val normalized = CaptureSourceRules.normalizeSmsSender(sender)
        if (normalized !in approvedSenders) return SmsHistoryOutcome.SKIPPED
        if (CaptureFilter.matchSmsSender(sender, currentSources()) == null) return SmsHistoryOutcome.SKIPPED

        // 실시간 수집은 PDU의 발신 시각을 ID에 사용한다. DATE(폰 도착 시각)로
        // 대체하면 같은 SMS가 별도 사건이 되므로 DATE_SENT 없는 항목은 보류한다.
        if (entry.sentAt <= 0 || entry.sentAt > range.through ||
            entry.sentAt < range.oldestSupportedTimestamp
        ) return SmsHistoryOutcome.MISSING_TIMESTAMP

        val body = readBody() ?: return SmsHistoryOutcome.SKIPPED
        if (!CaptureFilter.hasTransactionKeyword(body)) return SmsHistoryOutcome.SKIPPED
        // 가져오는 도중 사용자가 등록을 지웠으면 저장하지 않는다.
        val source = CaptureFilter.matchSmsSender(sender, currentSources())
            ?: return SmsHistoryOutcome.SKIPPED
        val message = PendingMessage(
            clientMessageId = CaptureEventId.sms(sender, entry.sentAt, body),
            source = "SMS",
            originKind = source.kind.wireValue,
            packageName = sender,
            title = "",
            body = body,
            receivedAt = entry.sentAt,
        )
        return when (enqueue(message)) {
            QueueEnqueueResult.INSERTED -> SmsHistoryOutcome.QUEUED
            QueueEnqueueResult.ALREADY_QUEUED -> SmsHistoryOutcome.ALREADY_QUEUED
        }
    }
}
