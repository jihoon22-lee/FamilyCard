package com.familycard.collector.capture

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationBodyExtractorTest {
    @Test
    fun `펼침 본문을 축약 본문보다 우선한다`() {
        val result = NotificationBodyExtractor.selectBody(
            bigText = "○○카드 승인\n12,000원\n테스트가맹점",
            text = "○○카드 승인 12,000원…",
            textLines = null,
        )

        assertEquals("○○카드 승인\n12,000원\n테스트가맹점", result)
    }

    @Test
    fun `펼침 본문이 없으면 줄 배열의 개행을 보존한다`() {
        val result = NotificationBodyExtractor.selectBody(
            bigText = null,
            text = "축약본",
            textLines = listOf("○○카드 승인", "12,000원", "테스트가맹점"),
        )

        assertEquals("○○카드 승인\n12,000원\n테스트가맹점", result)
    }

    @Test
    fun `다른 후보가 없으면 기본 본문을 사용한다`() {
        assertEquals(
            "○○카드 승인 12,000원",
            NotificationBodyExtractor.selectBody(null, "○○카드 승인 12,000원", null),
        )
    }
}
