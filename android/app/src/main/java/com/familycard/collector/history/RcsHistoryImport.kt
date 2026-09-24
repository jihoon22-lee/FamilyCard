package com.familycard.collector.history

import com.familycard.collector.capture.CaptureEventId
import com.familycard.collector.capture.CaptureFilter
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueEnqueueResult

/** 삼성 시스템 보관함의 수신 RCS. 본문은 JSON이어도 그대로 보존한다. */
object RcsHistoryImport {
    const val MAX_BODY_LENGTH = 64_000
    private val unicodeEscape = Regex("\\\\u([0-9a-fA-F]{4})")

    fun copyOne(
        entry: SmsHistoryEntry,
        type: Int,
        range: SmsHistoryRange,
        approvedSenders: Set<String>,
        currentSources: () -> List<CaptureSourceConfig>,
        readBody: () -> String?,
        enqueue: (PendingMessage) -> QueueEnqueueResult,
    ): SmsHistoryOutcome {
        if (type != 1 || entry.id < 0 || entry.receivedAt !in range.from..range.through) return SmsHistoryOutcome.SKIPPED
        val sender = entry.sender ?: return SmsHistoryOutcome.SKIPPED
        if (CaptureSourceRules.normalizeSmsSender(sender) !in approvedSenders) return SmsHistoryOutcome.SKIPPED
        if (CaptureFilter.matchSmsSender(sender, currentSources()) == null) return SmsHistoryOutcome.SKIPPED
        val body = readBody() ?: return SmsHistoryOutcome.SKIPPED
        if (body.length > MAX_BODY_LENGTH) return SmsHistoryOutcome.OVERSIZED
        // 거래 필드를 파싱하지 않는다. JSON Unicode escape 안의 기존 거래 어휘만 확인.
        val filterText = unicodeEscape.replace(body) { it.groupValues[1].toInt(16).toChar().toString() }
        if (!CaptureFilter.hasTransactionKeyword(filterText)) return SmsHistoryOutcome.SKIPPED
        if (CaptureFilter.matchSmsSender(sender, currentSources()) == null) return SmsHistoryOutcome.SKIPPED
        val result = enqueue(PendingMessage(
            clientMessageId = CaptureEventId.rcs(entry.id, sender, entry.receivedAt, body),
            source = "RCS",
            originKind = "SMS_SENDER", // 기존에 사용자가 등록한 문자 발신자 allowlist
            packageName = sender,
            title = "",
            body = body,
            receivedAt = entry.receivedAt,
        ))
        return if (result == QueueEnqueueResult.INSERTED) SmsHistoryOutcome.QUEUED else SmsHistoryOutcome.ALREADY_QUEUED
    }
}
