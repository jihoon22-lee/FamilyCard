package com.familycard.collector.net

import com.familycard.collector.queue.PendingMessage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class IngestClientTest {

    private val sample = PendingMessage(
        id = 1,
        source = "NOTIFICATION",
        packageName = "test.card.app",
        title = "테스트카드 승인",
        body = "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
        receivedAt = 1_754_804_587_000L,
    )

    @Test
    fun `요청 본문에 memberId 를 담지 않는다`() {
        // 소유자는 서버가 디바이스 토큰에서 유도한다. 클라이언트가 주장하는
        // 소유자를 서버가 믿으면 남의 데이터에 쓰기가 가능해진다.
        val body = IngestClient.buildRequestBody(listOf(sample))

        assertFalse(body.contains("memberId"))
        assertFalse(body.contains("deviceId"))
    }

    @Test
    fun `요청 본문이 서버 계약대로 만들어진다`() {
        val json = JSONObject(IngestClient.buildRequestBody(listOf(sample)))
        val message = json.getJSONArray("messages").getJSONObject(0)

        assertEquals("NOTIFICATION", message.getString("source"))
        assertEquals("test.card.app", message.getString("packageName"))
        assertEquals("테스트카드 승인", message.getString("title"))
        assertEquals(sample.body, message.getString("body"))
        // 서버가 파싱할 수 있는 ISO-8601 UTC
        assertEquals("2025-08-10T05:43:07.000Z", message.getString("receivedAt"))
    }

    @Test
    fun `빈 배치도 유효한 본문을 만든다`() {
        val json = JSONObject(IngestClient.buildRequestBody(emptyList()))
        assertEquals(0, json.getJSONArray("messages").length())
    }

    @Test
    fun `응답을 파싱한다`() {
        val response = IngestClient.parseResponse("""{"accepted":2,"duplicates":1,"rejected":0}""")

        assertEquals(2, response.accepted)
        assertEquals(1, response.duplicates)
        assertEquals(0, response.rejected)
        assertEquals(3, response.total())
    }

    @Test
    fun `필드가 빠진 응답은 0 으로 읽는다`() {
        // 서버가 필드를 빼먹으면 total 이 보낸 개수보다 작아지고,
        // UploadPolicy 가 큐를 유지한다 — 안전한 방향이다.
        val response = IngestClient.parseResponse("""{"accepted":1}""")

        assertEquals(1, response.total())
    }

    @Test
    fun `epoch millis 를 UTC ISO-8601 로 바꾼다`() {
        assertEquals("1970-01-01T00:00:00.000Z", IngestClient.formatIso8601(0L))
    }
}
