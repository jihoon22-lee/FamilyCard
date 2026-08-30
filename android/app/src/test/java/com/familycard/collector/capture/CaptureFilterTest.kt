package com.familycard.collector.capture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** 개인정보 경계 테스트. 모든 값은 가공된 테스트 전용 값이다. */
class CaptureFilterTest {
    private val sources = listOf(
        CaptureSourceConfig(CaptureOriginKind.CARD_APP, "com.example.testcard", "테스트카드"),
        CaptureSourceConfig(CaptureOriginKind.PAYMENT_APP, "com.example.testpay", "테스트페이"),
        CaptureSourceConfig(CaptureOriginKind.KAKAO_CHANNEL, "○○카드 공식 알림", "○○카드 공식 알림"),
        CaptureSourceConfig(CaptureOriginKind.SMS_SENDER, "15880000", "○○카드 문자"),
    )

    @Test
    fun `★★ 등록 목록이 비어 있으면 모든 알림과 SMS를 거부한다`() {
        assertNull(CaptureFilter.matchNotification("com.example.testcard", "승인", emptyList()))
        assertNull(CaptureFilter.matchNotification(CaptureFilter.KAKAO_PACKAGE, "○○카드", emptyList()))
        assertNull(CaptureFilter.matchSmsSender("1588-0000", emptyList()))
    }

    @Test
    fun `등록된 카드사 앱과 결제 앱을 종류까지 구분한다`() {
        assertEquals(
            CaptureOriginKind.CARD_APP,
            CaptureFilter.matchNotification("com.example.testcard", "", sources)?.kind,
        )
        assertEquals(
            CaptureOriginKind.PAYMENT_APP,
            CaptureFilter.matchNotification("com.example.testpay", "승인", sources)?.kind,
        )
        assertNull(CaptureFilter.matchNotification("com.example.testcard.fake", "승인", sources))
    }

    @Test
    fun `확인된 카카오 채널 제목만 정확히 수집한다`() {
        assertEquals(
            CaptureOriginKind.KAKAO_CHANNEL,
            CaptureFilter.matchNotification(
                CaptureFilter.KAKAO_PACKAGE,
                "○○카드 공식 알림",
                sources,
            )?.kind,
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
            assertNull(
                "카카오톡 제목 '$title' 이 수집 대상으로 잡혔다 — 사생활 유출",
                CaptureFilter.matchNotification(CaptureFilter.KAKAO_PACKAGE, title, sources),
            )
        }
    }

    @Test
    fun `카카오톡이 앱 출처로 잘못 저장돼도 전체 앱을 수집하지 않는다`() {
        val malformed = sources + CaptureSourceConfig(
            CaptureOriginKind.PAYMENT_APP,
            CaptureFilter.KAKAO_PACKAGE,
            "카카오톡 전체",
        )

        assertNull(
            CaptureFilter.matchNotification(CaptureFilter.KAKAO_PACKAGE, "개인 대화방", malformed),
        )
    }

    @Test
    fun `화이트리스트 밖의 앱은 제목이 무엇이든 수집하지 않는다`() {
        assertNull(
            CaptureFilter.matchNotification("com.google.android.gm", "○○카드 공식 알림", sources),
        )
    }

    @Test
    fun `등록 목록에 있어도 현재 기본 SMS 앱은 런타임에 거부한다`() {
        val smsApp = CaptureSourceConfig(
            CaptureOriginKind.PAYMENT_APP,
            "com.example.messages",
            "테스트 문자 앱",
        )

        assertNull(
            CaptureFilter.matchNotification(
                packageName = smsApp.identifier,
                title = "개인 문자",
                sources = sources + smsApp,
                blockedAppPackages = setOf(smsApp.identifier),
            ),
        )
    }

    @Test
    fun `등록된 SMS 발신자는 본문을 읽기 전에 정규화해 찾는다`() {
        assertEquals(
            CaptureOriginKind.SMS_SENDER,
            CaptureFilter.matchSmsSender("1588-0000", sources)?.kind,
        )
        assertNull(CaptureFilter.matchSmsSender("010-1234-5678", sources))
        assertNull(CaptureFilter.matchSmsSender(null, sources))
    }

    @Test
    fun `등록된 발신자라도 거래 어휘가 없는 광고는 거부한다`() {
        assertEquals(true, CaptureFilter.hasTransactionKeyword("○○카드 승인 12,000원"))
        assertFalse(CaptureFilter.hasTransactionKeyword("○○카드 새 이벤트 안내"))
    }
}
