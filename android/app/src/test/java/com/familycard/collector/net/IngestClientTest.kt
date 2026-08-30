package com.familycard.collector.net

import com.familycard.collector.queue.PendingMessage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class IngestClientTest {
    private val sample = PendingMessage(
        id = 1,
        clientMessageId = "11111111-1111-4111-8111-111111111111",
        source = "NOTIFICATION",
        originKind = "CARD_APP",
        packageName = "com.example.testcard",
        title = "테스트카드 승인",
        body = "홍길동님 12,000원 일시불 08/10 14:23 테스트가맹점",
        receivedAt = 1_754_804_587_000L,
    )

    @Test
    fun `요청은 clientMessageId를 보내고 소유자 ID는 보내지 않는다`() {
        val body = IngestClient.buildRequestBody(listOf(sample))
        val message = JSONObject(body).getJSONArray("messages").getJSONObject(0)

        assertEquals(sample.clientMessageId, message.getString("clientMessageId"))
        assertFalse(body.contains("memberId"))
        assertFalse(body.contains("deviceId"))
    }

    @Test
    fun `요청 본문이 서버 계약대로 만들어진다`() {
        val message = JSONObject(IngestClient.buildRequestBody(listOf(sample)))
            .getJSONArray("messages")
            .getJSONObject(0)

        assertEquals("NOTIFICATION", message.getString("source"))
        assertEquals("CARD_APP", message.getString("originKind"))
        assertEquals("com.example.testcard", message.getString("packageName"))
        assertEquals(sample.body, message.getString("body"))
        assertEquals("2025-08-10T05:43:07.000Z", message.getString("receivedAt"))
    }

    @Test
    fun `항목별 응답을 엄격하게 파싱한다`() {
        val response = IngestClient.parseResponse(
            """
            {
              "accepted":1,"duplicates":1,"rejected":1,
              "results":[
                {"clientMessageId":"a","status":"accepted"},
                {"clientMessageId":"b","status":"duplicate"},
                {"clientMessageId":"c","status":"rejected","reason":"body_too_long"}
              ]
            }
            """.trimIndent(),
        )

        assertEquals(3, response.total())
        assertEquals(IngestItemStatus.REJECTED, response.results[2].status)
        assertEquals("body_too_long", response.results[2].reason)
    }

    @Test
    fun `필드가 빠지거나 상태가 알 수 없으면 프로토콜 오류다`() {
        assertThrows(IngestProtocolException::class.java) {
            IngestClient.parseResponse("""{"accepted":1}""")
        }
        assertThrows(IngestProtocolException::class.java) {
            IngestClient.parseResponse(
                """{"accepted":1,"duplicates":0,"rejected":0,"results":[{"clientMessageId":"a","status":"mystery"}]}""",
            )
        }
    }

    @Test
    fun `epoch millis를 UTC ISO-8601로 바꾼다`() {
        assertEquals("1970-01-01T00:00:00.000Z", IngestClient.formatIso8601(0L))
    }
}
