package com.familycard.collector.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CaptureEventIdTest {
    @Test
    fun `같은 알림 콜백은 같은 ID를 만든다`() {
        assertEquals(
            CaptureEventId.notification(
                "test-notification-key",
                1_700_000_000_000L,
                "가공된 승인 원문",
            ),
            CaptureEventId.notification(
                "test-notification-key",
                1_700_000_000_000L,
                "가공된 승인 원문",
            ),
        )
    }

    @Test
    fun `같은 알림 키라도 새 수신 시각이면 다른 사건이다`() {
        assertNotEquals(
            CaptureEventId.notification("test-notification-key", 1_700_000_000_000L, "가공된 승인 원문"),
            CaptureEventId.notification("test-notification-key", 1_700_000_001_000L, "가공된 승인 원문"),
        )
    }

    @Test
    fun `같은 알림 레코드가 다른 본문으로 갱신되면 새 사건이다`() {
        assertNotEquals(
            CaptureEventId.notification("test-notification-key", 1_700_000_000_000L, "가공된 승인 원문"),
            CaptureEventId.notification("test-notification-key", 1_700_000_000_000L, "가공된 취소 원문"),
        )
    }

    @Test
    fun `SMS 본문이나 시각이 다르면 다른 사건이다`() {
        val first = CaptureEventId.sms("15880000", 1_700_000_000_000L, "○○카드 승인 12,000원")
        assertNotEquals(first, CaptureEventId.sms("15880000", 1_700_000_000_001L, "○○카드 승인 12,000원"))
        assertNotEquals(first, CaptureEventId.sms("15880000", 1_700_000_000_000L, "○○카드 승인 13,000원"))
    }
}
