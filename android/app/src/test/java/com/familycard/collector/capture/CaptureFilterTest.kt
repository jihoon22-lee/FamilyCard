package com.familycard.collector.capture

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 화이트리스트 필터 테스트.
 *
 * ★★ 로 표시한 것이 이 앱에서 가장 중요한 테스트다. 카카오톡 일반 대화가
 * 서버에 올라가면 가족의 사생활이 통째로 유출된다. 앱을 배포하기 전에 반드시
 * 통과해야 한다.
 *
 * → AGENTS.md 불변 규칙 4
 */
class CaptureFilterTest {

    // ── 카카오톡 ────────────────────────────────────────────────

    @Test
    fun `★★ 카카오톡 일반 대화는 수집하지 않는다`() {
        val 일반대화제목 = listOf(
            "엄마",
            "김철수",
            "가족 단톡방",
            "회사 사람들",
            "배달의민족",
            "친구",
            "홍길동",
        )

        일반대화제목.forEach { title ->
            assertFalse(
                "카카오톡 제목 '$title' 이 수집 대상으로 잡혔다 — 사생활 유출",
                CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, title),
            )
        }
    }

    @Test
    fun `카카오톡이라도 제목이 카드사면 수집한다`() {
        val 카드사제목 = listOf("신한카드", "신한 카드", "KB국민카드", "삼성카드 알림", "현대카드")

        카드사제목.forEach { title ->
            assertTrue(
                "카드사 제목 '$title' 이 걸러졌다",
                CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, title),
            )
        }
    }

    @Test
    fun `카카오톡 제목이 비어 있으면 수집하지 않는다`() {
        assertFalse(CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, ""))
    }

    @Test
    fun `'카드' 라는 단어만으로는 통과하지 못한다`() {
        // "카드"가 들어간 일상 대화가 걸리면 안 된다.
        val 함정 = listOf("카드 게임 하자", "생일 카드 보냈어", "SD카드 어디 있어?")

        함정.forEach { title ->
            assertFalse(
                "'$title' 이 카드사 알림으로 오인됐다",
                CaptureFilter.shouldCaptureNotification(CaptureFilter.KAKAO_PACKAGE, title),
            )
        }
    }

    // ── 그 외 앱 ────────────────────────────────────────────────

    @Test
    fun `화이트리스트 밖의 앱은 제목이 무엇이든 수집하지 않는다`() {
        val 다른앱 = listOf(
            "com.android.messaging",
            "com.google.android.gm",
            "com.instagram.android",
            "com.nhn.android.search",
        )

        다른앱.forEach { pkg ->
            // 제목이 카드사 패턴이어도 안 된다 — 패키지가 먼저다.
            assertFalse(
                "$pkg 의 알림이 수집 대상으로 잡혔다",
                CaptureFilter.shouldCaptureNotification(pkg, "신한카드 승인"),
            )
        }
    }

    @Test
    fun `카드사 앱 목록에 있으면 제목과 무관하게 수집한다`() {
        // 실기기 확인 전이라 목록이 비어 있다. 목록이 채워지면 이 테스트가
        // 실제로 의미를 갖는다. 비어 있는 동안에도 "목록에 있으면 통과"라는
        // 규칙 자체는 검증해 둔다.
        CaptureFilter.cardAppPackages.forEach { pkg ->
            assertTrue(CaptureFilter.shouldCaptureNotification(pkg, ""))
            assertTrue(CaptureFilter.shouldCaptureNotification(pkg, "아무 제목"))
        }
    }

    @Test
    fun `카드사 앱 패키지 목록은 실기기 확인 전까지 비어 있다`() {
        // 이 테스트는 "아직 확인 안 됨"을 드러내기 위한 것이다.
        // 실기기에서 패키지명을 확인해 채우면 이 테스트를 지우고 위의
        // 목록 기반 테스트를 실제 값으로 바꿔야 한다.
        assertTrue(
            "패키지 목록이 채워졌다면 이 테스트를 실제 검증으로 교체하세요",
            CaptureFilter.cardAppPackages.isEmpty(),
        )
    }

    // ── SMS ────────────────────────────────────────────────────

    @Test
    fun `발신번호가 없으면 SMS 를 수집하지 않는다`() {
        assertFalse(CaptureFilter.shouldCaptureSms(null, "신한카드 승인 12,000원"))
    }

    @Test
    fun `★★ 개인 문자는 수집하지 않는다`() {
        val 개인문자 = listOf(
            "010-1234-5678" to "오늘 저녁에 뭐 먹을까?",
            "010-1234-5678" to "카드 게임 하러 갈래?",
            "010-1234-5678" to "승인 났어? 결과 알려줘",
            "02-123-4567" to "예약 확인되었습니다",
        )

        개인문자.forEach { (sender, body) ->
            assertFalse(
                "개인 문자가 수집 대상으로 잡혔다: '$body'",
                CaptureFilter.shouldCaptureSms(sender, body),
            )
        }
    }

    @Test
    fun `카드사명과 거래 어휘가 함께 있으면 SMS 를 수집한다`() {
        assertTrue(
            CaptureFilter.shouldCaptureSms(
                "15771234",
                "[Web발신]\n신한카드(1234) 승인\n12,000원 일시불\n08/10 14:23 테스트가맹점",
            ),
        )
    }

    @Test
    fun `카드사명만 있고 거래 어휘가 없으면 수집하지 않는다`() {
        // 카드사 광고 문자 등. 둘 다 있어야 통과한다.
        assertFalse(
            CaptureFilter.shouldCaptureSms("15771234", "신한카드 고객님, 이벤트에 참여하세요"),
        )
    }
}
