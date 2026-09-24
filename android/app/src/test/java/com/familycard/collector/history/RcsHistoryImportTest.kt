package com.familycard.collector.history

import com.familycard.collector.capture.CaptureEventId
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.net.IngestClient
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueEnqueueResult
import com.familycard.collector.queue.UploadPolicy
import org.junit.Assert.*
import org.junit.Test

class RcsHistoryImportTest {
    private val now = 1_800_000_000_000L
    private val range = SmsHistoryRange.recent(90, now)
    private val source = CaptureSourceConfig(CaptureOriginKind.SMS_SENDER, "15880000", "가공 카드사")
    private val entry = SmsHistoryEntry(10, source.identifier, now - 1_000, 0)
    // 실제 스크린샷의 금융 값은 사용하지 않는다. 원문 JSON 전체 보존을 검증한다.
    private val body = """{"layout":{"children":[{"text":"테스트카드 홍길동님 테스트가맹점 부분취소(-12,000원)"}]},"suggestions":[]}"""

    private fun copy(
        row: SmsHistoryEntry = entry,
        type: Int = 1,
        approved: Set<String> = setOf(source.identifier),
        current: () -> List<CaptureSourceConfig> = { listOf(source) },
        read: () -> String? = { body },
        save: (PendingMessage) -> QueueEnqueueResult = { QueueEnqueueResult.INSERTED },
        allText: () -> Boolean = { false },
    ) = RcsHistoryImport.copyOne(row, type, range, approved, current, read, save, allText)

    @Test fun `모든 문구 보관을 선택하면 처음 보는 RCS JSON도 원형 보존한다`() {
        val unknown = """{"text":"새로운 형식의 테스트 안내 12,000원"}"""
        var saved: PendingMessage? = null
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(read = { unknown }))
        assertEquals(SmsHistoryOutcome.QUEUED, copy(read = { unknown }, allText = { true },
            save = { saved = it; QueueEnqueueResult.INSERTED }))
        assertEquals(unknown, saved?.body)
    }

    @Test fun `모든 문구 보관도 발신자와 수신 종류의 경계를 넓히지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = entry.copy(sender = "01000000000"),
            allText = { true }, read = { error("private body accessed") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(approved = emptySet(),
            allText = { true }, read = { error("unapproved") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(type = 2,
            allText = { true }, read = { error("outgoing body accessed") }))
    }

    @Test fun `본문을 읽는 중 모든 문구 보관을 끄면 새 형식을 저장하지 않는다`() {
        var enabled = true
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(allText = { enabled },
            read = { enabled = false; "새 테스트 안내" }, save = { error("disabled") }))
    }

    @Test fun `부분취소 RCS JSON은 그대로 RCS 출처로 보존한다`() {
        var saved: PendingMessage? = null
        assertEquals(SmsHistoryOutcome.QUEUED, copy(save = { saved = it; QueueEnqueueResult.INSERTED }))
        val message = requireNotNull(saved)
        assertEquals(body, message.body)
        assertEquals("RCS", message.source)
        assertEquals("SMS_SENDER", message.originKind)
        assertEquals(entry.receivedAt, message.receivedAt)
        assertNotEquals(CaptureEventId.sms(source.identifier, entry.receivedAt, body), message.clientMessageId)
    }

    @Test fun `발신자 미등록 및 비수신 행은 본문에 접근하지 않는다`() {
        val unread: () -> String? = { error("private body accessed") }
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = entry.copy(sender = "01000000000"), read = unread))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(type = 2, read = unread))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(type = 0, read = unread))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = entry.copy(sender = null), read = unread))
    }

    @Test fun `빈 목록과 삭제된 발신자는 본문에 접근하지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(approved = emptySet(), read = { error("unapproved") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(current = { emptyList() }, read = { error("removed") }))
    }

    @Test fun `필터는 정규화하되 원래 발신자는 보존한다`() {
        var saved: PendingMessage? = null
        copy(row = entry.copy(sender = "1588-0000"), save = { saved = it; QueueEnqueueResult.INSERTED })
        assertEquals("1588-0000", saved?.packageName)
    }

    @Test fun `새 등록은 실행 시 승인 목록을 넓히지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(approved = setOf("15990000"), read = { error("scope expansion") }))
    }

    @Test fun `본문 조회 중 발신자 삭제시 저장하지 않는다`() {
        var current = listOf(source)
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(current = { current }, read = { current = emptyList(); body }, save = { error("removed") }))
    }

    @Test fun `기간 밖과 음수 행 ID는 본문을 읽지 않는다`() {
        for (row in listOf(entry.copy(receivedAt = range.from - 1), entry.copy(receivedAt = now + 1), entry.copy(id = -1))) {
            assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = row, read = { error("out of range") }))
        }
    }

    @Test fun `Unicode escape 취소 어휘도 인식하지만 JSON 원문은 유지한다`() {
        val escaped = """{"text":"\uBD80\uBD84\uCDE8\uC18C(-12,000원)"}"""
        var saved: PendingMessage? = null
        assertEquals(SmsHistoryOutcome.QUEUED, copy(read = { escaped }, save = { saved = it; QueueEnqueueResult.INSERTED }))
        assertEquals(escaped, saved?.body)
    }

    @Test fun `반복 가져오기는 동일 ID이며 별도 행과 본문 변경은 보존한다`() {
        val ids = mutableSetOf<String>()
        val save: (PendingMessage) -> QueueEnqueueResult = { if (ids.add(it.clientMessageId)) QueueEnqueueResult.INSERTED else QueueEnqueueResult.ALREADY_QUEUED }
        assertEquals(SmsHistoryOutcome.QUEUED, copy(save = save))
        assertEquals(SmsHistoryOutcome.ALREADY_QUEUED, copy(save = save))
        assertEquals(SmsHistoryOutcome.QUEUED, copy(row = entry.copy(id = 11), save = save))
        assertEquals(SmsHistoryOutcome.QUEUED, copy(read = { body + " " }, save = save))
    }

    @Test fun `본문 초과와 비거래는 저장하지 않는다`() {
        assertEquals(SmsHistoryOutcome.OVERSIZED, copy(read = { "취소" + "x".repeat(64_000) }, save = { error("oversize") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(read = { "테스트 안내" }, save = { error("nontransaction") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(read = { null }))
    }

    @Test(expected = SecurityException::class) fun `권한 철회는 실패로 전달한다`() {
        copy(read = { throw SecurityException("synthetic") })
    }

    @Test(expected = IllegalStateException::class) fun `큐 오류는 성공 처리하지 않는다`() {
        copy(save = { error("synthetic queue failure") })
    }

    @Test fun `최대 크기 RCS 묶음은 요청 바이트 상한 안에서 순서대로 분할된다`() {
        val body = "\u0001".repeat(64_000) // JSON escape worst case, synthetic only
        val messages = (1..200).map { PendingMessage(clientMessageId = "test-$it", source = "RCS", originKind = "SMS_SENDER", packageName = "15880000", title = "", body = body, receivedAt = now) }
        var remaining = messages
        val delivered = mutableListOf<PendingMessage>()
        while (remaining.isNotEmpty()) {
            val batch = UploadPolicy.boundedBatch(remaining)
            assertTrue(batch.isNotEmpty())
            assertTrue(IngestClient.buildRequestBody(batch).toByteArray(Charsets.UTF_8).size < 6_000_000)
            delivered += batch
            remaining = remaining.drop(batch.size)
        }
        assertEquals(messages, delivered)
    }
}
