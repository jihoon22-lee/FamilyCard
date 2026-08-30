package com.familycard.collector.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 개인정보 경계 테스트. 모든 값은 가공된 테스트 전용 값이다. */
class CaptureFilterTest {
    private val verified = CaptureAllowlist(
        cardAppPackages = setOf("com.example.testcard"),
        kakaoChannelTitles = setOf("○○카드 공식 알림"),
        cardSmsSenders = setOf("15880000"),
    )

    @Test
    fun `★★ 운영 기본 목록은 실기기 확인 전까지 모든 알림을 거부한다`() {
        assertFalse(CaptureFilter.shouldCaptureNotification("com.example.testcard", "승인"))
        assertFalse(CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, "신한카드"))
        assertFalse(CaptureFilter.shouldCaptureSms("1588-0000", "○○카드 승인 12,000원"))
    }

    @Test
    fun `확인된 카드 앱 패키지만 제목과 무관하게 수집한다`() {
        assertTrue(CaptureFilter.shouldCaptureNotification("com.example.testcard", "", verified))
        assertFalse(CaptureFilter.shouldCaptureNotification("com.example.testcard.fake", "승인", verified))
    }

    @Test
    fun `확인된 카카오 채널 제목만 정확히 수집한다`() {
        assertTrue(
            CaptureFilter.shouldCaptureNotification(
                CaptureFilter.KAKAO_PACKAGE,
                "○○카드 공식 알림",
                verified,
            ),
        )
        assertTrue(
            CaptureFilter.shouldCaptureNotification(
                CaptureFilter.KAKAO_PACKAGE,
                "  ○○카드 공식 알림  ",
                verified,
            ),
        )
    }

    @Test
    fun `★★ 카드사 단어가 포함된 일반 카카오톡 방은 수집하지 않는다`() {
        val traps = listOf(
            "신한카드 혜택 공유",
            "○○카드 공식 알림 친구들",
            "카드 승인 내역 확인방",
            "가족 단톡방",
        )

        traps.forEach { title ->
            assertFalse(
                "카카오톡 제목 '$title' 이 수집 대상으로 잡혔다 — 사생활 유출",
                CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, title, verified),
            )
        }
    }

    @Test
    fun `화이트리스트 밖의 앱은 제목이 무엇이든 수집하지 않는다`() {
        assertFalse(
            CaptureFilter.shouldCaptureNotification(
                "com.google.android.gm",
                "○○카드 공식 알림",
                verified,
            ),
        )
    }

    @Test
    fun `확인된 SMS 발신번호와 거래 어휘가 함께 있어야 수집한다`() {
        assertTrue(CaptureFilter.shouldCaptureSms("1588-0000", "○○카드 승인 12,000원", verified))
        assertFalse(CaptureFilter.shouldCaptureSms("1588-0000", "○○카드 새 이벤트 안내", verified))
    }

    @Test
    fun `★★ 본문이 카드 알림처럼 보여도 미확인 발신번호는 수집하지 않는다`() {
        assertFalse(
            CaptureFilter.shouldCaptureSms(
                "010-1234-5678",
                "○○카드 승인 12,000원 결제됐어?",
                verified,
            ),
        )
    }

    @Test
    fun `발신번호가 없으면 SMS를 수집하지 않는다`() {
        assertFalse(CaptureFilter.shouldCaptureSms(null, "○○카드 승인 12,000원", verified))
    }
}
