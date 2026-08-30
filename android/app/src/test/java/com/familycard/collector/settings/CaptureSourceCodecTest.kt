package com.familycard.collector.settings

import com.familycard.collector.capture.CaptureOriginKind
import com.familycard.collector.capture.CaptureSourceConfig
import com.familycard.collector.capture.CaptureSourceRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureSourceCodecTest {
    @Test
    fun `모든 사용자 관리 출처를 JSON으로 왕복한다`() {
        val sources = listOf(
            CaptureSourceConfig(CaptureOriginKind.CARD_APP, "com.example.card", "테스트카드"),
            CaptureSourceConfig(CaptureOriginKind.PAYMENT_APP, "com.example.pay", "테스트페이"),
            CaptureSourceConfig(CaptureOriginKind.KAKAO_CHANNEL, "○○카드 공식", "○○카드 공식"),
            CaptureSourceConfig(CaptureOriginKind.SMS_SENDER, "15880000", "○○카드 문자"),
        )

        assertEquals(
            sources.toSet(),
            CaptureSourceCodec.decode(CaptureSourceCodec.encode(sources)).toSet(),
        )
    }

    @Test
    fun `손상 JSON과 알 수 없는 종류는 수집 대상을 만들지 않는다`() {
        assertEquals(emptyList<CaptureSourceConfig>(), CaptureSourceCodec.decode("not-json"))
        assertEquals(
            emptyList<CaptureSourceConfig>(),
            CaptureSourceCodec.decode(
                """[{"kind":"MYSTERY","identifier":"com.example.app","displayName":"앱"}]""",
            ),
        )
    }

    @Test
    fun `UNKNOWN_APP은 레거시 전송용일 뿐 사용자 설정으로 복원하지 않는다`() {
        assertEquals(
            emptyList<CaptureSourceConfig>(),
            CaptureSourceCodec.decode(
                """[{"kind":"UNKNOWN_APP","identifier":"com.example.app","displayName":"앱"}]""",
            ),
        )
    }

    @Test
    fun `같은 앱 패키지가 두 종류로 있으면 마지막 분류만 복원한다`() {
        val decoded = CaptureSourceCodec.decode(
            """
            [
              {"kind":"CARD_APP","identifier":"com.example.app","displayName":"카드 앱"},
              {"kind":"PAYMENT_APP","identifier":"com.example.app","displayName":"결제 앱"}
            ]
            """.trimIndent(),
        )

        assertEquals(1, decoded.size)
        assertEquals(CaptureOriginKind.PAYMENT_APP, decoded.single().kind)
    }

    @Test
    fun `여러 앱을 한 번에 추가하고 기존 앱은 새 분류로 바꾼다`() {
        val current = listOf(
            CaptureSourceConfig(CaptureOriginKind.CARD_APP, "com.example.shared", "기존 카드 앱"),
            CaptureSourceConfig(CaptureOriginKind.SMS_SENDER, "15880000", "기존 문자"),
        )
        val additions = listOf(
            CaptureSourceConfig(
                CaptureOriginKind.PAYMENT_APP,
                "com.example.shared",
                "새 결제 앱",
            ),
            CaptureSourceConfig(CaptureOriginKind.CARD_APP, "com.example.second", "두 번째 카드"),
        )

        val merged = CaptureSourceMerge.merge(current, additions)!!

        assertEquals(3, merged.size)
        assertEquals(
            CaptureOriginKind.PAYMENT_APP,
            merged.single { it.identifier == "com.example.shared" }.kind,
        )
        assertEquals("기존 문자", merged.single { it.kind == CaptureOriginKind.SMS_SENDER }.displayName)
    }

    @Test
    fun `일괄 추가에 잘못된 항목이 하나라도 있으면 전체를 거부한다`() {
        val additions = listOf(
            CaptureSourceConfig(CaptureOriginKind.CARD_APP, "com.example.valid", "정상"),
            CaptureSourceConfig(CaptureOriginKind.CARD_APP, "잘못된 패키지", "오류"),
        )

        assertNull(CaptureSourceMerge.merge(emptyList(), additions))
    }

    @Test
    fun `SMS 숫자와 영문 발신자 ID를 같은 규칙으로 정규화한다`() {
        assertEquals("15880000", CaptureSourceRules.normalizeSmsSender("1588-0000"))
        assertEquals("TESTCARD", CaptureSourceRules.normalizeSmsSender(" test-card "))
        assertNull(CaptureSourceRules.normalizeSmsSender("  "))
    }

    @Test
    fun `제어문자와 지나치게 긴 입력은 거부한다`() {
        assertNull(
            CaptureSourceRules.normalize(
                CaptureOriginKind.KAKAO_CHANNEL,
                "공식\n채널",
                "공식 채널",
            ),
        )
        assertNull(
            CaptureSourceRules.normalize(
                CaptureOriginKind.SMS_SENDER,
                "1".repeat(CaptureSourceRules.MAX_SMS_SENDER_LENGTH + 1),
                "문자",
            ),
        )
    }
}
