package com.familycard.collector.queue

import com.familycard.collector.net.IngestItemStatus
import com.familycard.collector.net.IngestResponse

data class QuarantinedPendingMessage(
    val message: PendingMessage,
    val reason: String,
)

data class UploadPlan(
    val deleteIds: List<Long>,
    val quarantined: List<QuarantinedPendingMessage>,
)

enum class UploadFailureAction { RETRY_WITH_BACKOFF, WAIT_FOR_NEXT_TRIGGER }

/** 서버 응답을 신뢰하기 전에 배치와 1:1로 대응하는지 검증한다. */
object UploadPolicy {
    private val RETRYABLE_HTTP_STATUS_CODES = setOf(408, 425, 429, 500, 502, 503, 504)

    fun failureActionForHttpStatus(statusCode: Int): UploadFailureAction =
        if (statusCode in RETRYABLE_HTTP_STATUS_CODES) {
            UploadFailureAction.RETRY_WITH_BACKOFF
        } else {
            UploadFailureAction.WAIT_FOR_NEXT_TRIGGER
        }

    fun buildPlan(batch: List<PendingMessage>, response: IngestResponse): UploadPlan? {
        if (batch.isEmpty()) return null
        if (response.accepted < 0 || response.duplicates < 0 || response.rejected < 0) return null
        if (response.total() != batch.size || response.results.size != batch.size) return null

        val sentByClientId = batch.associateBy(PendingMessage::clientMessageId)
        if (sentByClientId.size != batch.size) return null

        val resultByClientId = response.results.associateBy { it.clientMessageId }
        if (resultByClientId.size != response.results.size) return null
        if (resultByClientId.keys != sentByClientId.keys) return null

        val accepted = response.results.count { it.status == IngestItemStatus.ACCEPTED }
        val duplicates = response.results.count { it.status == IngestItemStatus.DUPLICATE }
        val rejected = response.results.count { it.status == IngestItemStatus.REJECTED }
        if (accepted != response.accepted || duplicates != response.duplicates || rejected != response.rejected) {
            return null
        }

        val deleteIds = mutableListOf<Long>()
        val quarantined = mutableListOf<QuarantinedPendingMessage>()
        response.results.forEach { result ->
            val message = sentByClientId.getValue(result.clientMessageId)
            when (result.status) {
                IngestItemStatus.ACCEPTED,
                IngestItemStatus.DUPLICATE,
                -> deleteIds += message.id

                IngestItemStatus.REJECTED -> quarantined += QuarantinedPendingMessage(
                    message = message,
                    reason = result.reason ?: "unknown_rejection",
                )
            }
        }

        return UploadPlan(deleteIds = deleteIds, quarantined = quarantined)
    }
}
