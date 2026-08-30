package com.familycard.collector.queue

import com.familycard.collector.net.IngestItemResult
import com.familycard.collector.net.IngestItemStatus
import com.familycard.collector.net.IngestResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UploadPolicyTest {
    private fun message(id: Long, clientId: String) = PendingMessage(
        id = id,
        clientMessageId = clientId,
        source = "NOTIFICATION",
        originKind = "CARD_APP",
        packageName = "com.example.testcard",
        title = "테스트카드 승인",
        body = "가공된 테스트 원문",
        receivedAt = 1_754_804_587_000L,
    )

    private val batch = listOf(message(1, "a"), message(2, "b"), message(3, "c"))

    @Test
    fun `일시적 HTTP 오류만 즉시 백오프 재시도한다`() {
        assertEquals(
            UploadFailureAction.RETRY_WITH_BACKOFF,
            UploadPolicy.failureActionForHttpStatus(503),
        )
        assertEquals(
            UploadFailureAction.WAIT_FOR_NEXT_TRIGGER,
            UploadPolicy.failureActionForHttpStatus(401),
        )
        assertEquals(
            UploadFailureAction.WAIT_FOR_NEXT_TRIGGER,
            UploadPolicy.failureActionForHttpStatus(413),
        )
    }

    @Test
    fun `승인과 중복만 삭제하고 거부는 격리한다`() {
        val response = IngestResponse(
            accepted = 1,
            duplicates = 1,
            rejected = 1,
            results = listOf(
                IngestItemResult("a", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("b", IngestItemStatus.DUPLICATE, null),
                IngestItemResult("c", IngestItemStatus.REJECTED, "received_at_in_future"),
            ),
        )

        val plan = UploadPolicy.buildPlan(batch, response)

        assertEquals(listOf(1L, 2L), plan?.deleteIds)
        assertEquals(listOf(3L), plan?.quarantined?.map { it.message.id })
        assertEquals("received_at_in_future", plan?.quarantined?.single()?.reason)
    }

    @Test
    fun `항목 ID가 빠지거나 중복되면 큐를 건드릴 계획을 만들지 않는다`() {
        val missing = IngestResponse(
            2,
            0,
            1,
            listOf(
                IngestItemResult("a", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("b", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("unknown", IngestItemStatus.REJECTED, "invalid"),
            ),
        )
        val duplicate = IngestResponse(
            2,
            0,
            1,
            listOf(
                IngestItemResult("a", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("a", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("c", IngestItemStatus.REJECTED, "invalid"),
            ),
        )

        assertNull(UploadPolicy.buildPlan(batch, missing))
        assertNull(UploadPolicy.buildPlan(batch, duplicate))
    }

    @Test
    fun `요약 건수와 항목 상태가 다르면 큐를 유지한다`() {
        val response = IngestResponse(
            accepted = 3,
            duplicates = 0,
            rejected = 0,
            results = listOf(
                IngestItemResult("a", IngestItemStatus.ACCEPTED, null),
                IngestItemResult("b", IngestItemStatus.DUPLICATE, null),
                IngestItemResult("c", IngestItemStatus.REJECTED, "invalid"),
            ),
        )

        assertNull(UploadPolicy.buildPlan(batch, response))
    }
}
