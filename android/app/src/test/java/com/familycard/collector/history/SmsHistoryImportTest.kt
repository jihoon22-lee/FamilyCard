package com.familycard.collector.history

import com.familycard.collector.capture.CaptureEventId
import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.queue.PendingMessage
import com.familycard.collector.queue.QueueEnqueueResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.fail
import org.junit.Test
import java.util.concurrent.TimeUnit

class SmsHistoryImportTest {
    private val now = 1_800_000_000_000L
    private val range = SmsHistoryRange.recent(90, now)
    private val source = CaptureSourceConfig(CaptureOriginKind.SMS_SENDER, "15880000", "가공 카드사")
    private val entry = SmsHistoryEntry(7, "15880000", now - 1_000, now - 10_000)
    private val body = "[○○카드]\n홍길동님 12,000원 승인\n테스트가맹점"

    private fun copy(
        row: SmsHistoryEntry = entry,
        sources: () -> List<CaptureSourceConfig> = { listOf(source) },
        approved: Set<String> = setOf(source.identifier),
        read: () -> String? = { body },
        save: (PendingMessage) -> QueueEnqueueResult = { QueueEnqueueResult.INSERTED },
    ) = SmsHistoryImport.copyOne(row, range, approved, sources, read, save)

    @Test
    fun `미등록 발신자는 거래 어휘와 무관하게 본문조차 읽지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(
            row = entry.copy(sender = "01000000000"),
            read = { fail("private body must not be read"); body },
            save = { fail("private message must not be queued"); QueueEnqueueResult.INSERTED },
        ))
    }

    @Test
    fun `빈 허용 목록과 손상 설정은 본문 읽기 전에 차단한다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(approved = emptySet(), read = { error("unexpected read") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(sources = { emptyList() }, read = { error("unexpected read") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = entry.copy(sender = null), read = { error("unexpected read") }))
    }

    @Test
    fun `실행 후 새로 등록된 발신자까지 범위를 넓히지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(
            row = entry.copy(sender = "15990000"),
            sources = { listOf(source.copy(identifier = "15990000")) },
            read = { error("not approved at start") },
        ))
    }

    @Test
    fun `현재 등록된 비 SMS 대상은 발신자로 인정하지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(
            sources = { listOf(source.copy(kind = CaptureOriginKind.KAKAO_CHANNEL)) },
            read = { error("not an SMS sender") },
        ))
    }

    @Test
    fun `허용 목록 정규화는 표시 형식만 다를 때도 적용한다`() {
        assertEquals(SmsHistoryOutcome.QUEUED, copy(row = entry.copy(sender = "1588-0000")))
    }

    @Test
    fun `수신일의 양쪽 기간 경계는 포함하고 밖은 본문을 읽지 않는다`() {
        assertEquals(SmsHistoryOutcome.QUEUED, copy(row = entry.copy(receivedAt = range.from)))
        assertEquals(SmsHistoryOutcome.QUEUED, copy(row = entry.copy(receivedAt = range.through)))
        for (date in listOf(range.from - 1, range.through + 1)) {
            assertEquals(SmsHistoryOutcome.SKIPPED, copy(row = entry.copy(receivedAt = date), read = { error("outside range") }))
        }
    }

    @Test
    fun `발신 시각이 없거나 비정상이면 도착 시각으로 ID를 추측하지 않는다`() {
        for (date in listOf(0L, -1L, now + 1, range.oldestSupportedTimestamp - 1)) {
            assertEquals(SmsHistoryOutcome.MISSING_TIMESTAMP, copy(row = entry.copy(sentAt = date), read = { error("invalid timestamp") }))
        }
    }

    @Test
    fun `문자함 도착 시각 대신 PDU와 같은 DATE_SENT로 실시간 수집 ID를 재사용한다`() {
        var saved: PendingMessage? = null
        assertEquals(SmsHistoryOutcome.QUEUED, copy(save = { saved = it; QueueEnqueueResult.INSERTED }))
        val message = requireNotNull(saved)
        assertEquals(CaptureEventId.sms("15880000", entry.sentAt, body), message.clientMessageId)
        assertEquals(entry.sentAt, message.receivedAt)
        assertEquals(body, message.body)
        assertEquals("SMS", message.source)
        assertEquals("SMS_SENDER", message.originKind)
    }

    @Test
    fun `재실행과 기간 확장 후에도 같은 문자는 같은 ID이며 별도 시각 문자는 유지한다`() {
        val ids = mutableSetOf<String>()
        val save: (PendingMessage) -> QueueEnqueueResult = {
            if (ids.add(it.clientMessageId)) QueueEnqueueResult.INSERTED else QueueEnqueueResult.ALREADY_QUEUED
        }
        assertEquals(SmsHistoryOutcome.QUEUED, copy(save = save))
        assertEquals(SmsHistoryOutcome.ALREADY_QUEUED, copy(save = save))
        // 서버도 동일 사건 ID로 멱등 처리한다. provider 행 ID가 바뀌어도 같다.
        assertEquals(SmsHistoryOutcome.ALREADY_QUEUED, copy(row = entry.copy(id = 99), save = save))
        assertEquals(SmsHistoryOutcome.ALREADY_QUEUED, SmsHistoryImport.copyOne(
            entry, SmsHistoryRange.recent(365, now), setOf(source.identifier), { listOf(source) }, { body }, save,
        ))
        assertEquals(SmsHistoryOutcome.QUEUED, copy(row = entry.copy(sentAt = entry.sentAt + 1_000), save = save))
        assertEquals(2, ids.size)
    }

    @Test
    fun `광고와 사라진 행은 저장하지 않는다`() {
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(read = { "테스트 광고 안내" }, save = { error("nontransaction") }))
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(read = { null }, save = { error("missing row") }))
    }

    @Test
    fun `본문을 읽는 동안 발신자가 삭제되면 저장 전에 다시 차단한다`() {
        var sources = listOf(source)
        assertEquals(SmsHistoryOutcome.SKIPPED, copy(
            sources = { sources },
            read = { sources = emptyList(); body },
            save = { error("source removed") },
        ))
    }

    @Test(expected = IllegalStateException::class)
    fun `큐 저장 실패를 성공으로 삼키지 않는다`() {
        copy(save = { throw IllegalStateException("synthetic storage failure") })
    }

    @Test(expected = SecurityException::class)
    fun `도중 권한 철회는 작업의 실패 처리 경로로 전달한다`() {
        copy(read = { throw SecurityException("synthetic permission loss") })
    }

    @Test
    fun `기간 선택은 지원 범위만 허용한다`() {
        assertEquals(now - TimeUnit.DAYS.toMillis(90), range.from)
        assertThrows(IllegalArgumentException::class.java) { SmsHistoryRange.recent(0, now) }
        assertThrows(IllegalArgumentException::class.java) { SmsHistoryRange.recent(366, now) }
    }
}
