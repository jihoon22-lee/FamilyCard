package com.familycard.collector.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CaptureAppSelectionPolicyTest {
    @Test
    fun `일반 카드사와 결제 앱 패키지는 허용한다`() {
        assertNull(
            CaptureAppSelectionPolicy.rejectionFor(
                "com.example.testpay",
                "com.familycard.collector",
                "com.example.messages",
            ),
        )
    }

    @Test
    fun `FamilyCard와 카카오톡과 기본 문자 앱은 전체 앱 출처로 막는다`() {
        assertEquals(
            AppSelectionRejection.FAMILYCARD_ITSELF,
            CaptureAppSelectionPolicy.rejectionFor(
                "com.familycard.collector",
                "com.familycard.collector",
                "com.example.messages",
            ),
        )
        assertEquals(
            AppSelectionRejection.KAKAO_TALK,
            CaptureAppSelectionPolicy.rejectionFor(
                "com.kakao.talk",
                "com.familycard.collector",
                "com.example.messages",
            ),
        )
        assertEquals(
            AppSelectionRejection.DEFAULT_SMS_APP,
            CaptureAppSelectionPolicy.rejectionFor(
                "com.example.messages",
                "com.familycard.collector",
                "com.example.messages",
            ),
        )
    }
}
