package com.familycard.collector.ui.settings

import com.familycard.collector.capture.CaptureOriginKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureAppPickerPolicyTest {
    private val apps = listOf(
        InstalledCaptureApp("com.example.notes", "메모장"),
        InstalledCaptureApp("viva.republica.toss", "토스"),
        InstalledCaptureApp("com.example.card", "나의 Card 도우미"),
        InstalledCaptureApp("com.shcard.smartpay", "신한 SOL페이"),
        InstalledCaptureApp("net.ib.android.smcard", "모니모"),
    )

    @Test
    fun `대상 종류의 공식 앱과 이름 추천과 나머지 순서로 정렬한다`() {
        val ranked = CaptureAppPickerPolicy.filterAndSort(
            apps,
            CaptureOriginKind.CARD_APP,
            query = "",
        )

        assertEquals(
            listOf(
                "com.shcard.smartpay",
                "net.ib.android.smcard",
                "com.example.card",
                "com.example.notes",
                "viva.republica.toss",
            ),
            ranked.map { it.app.packageName },
        )
        assertEquals(CaptureAppRecommendation.OFFICIAL, ranked[0].recommendation)
        assertEquals(CaptureAppRecommendation.KEYWORD, ranked[2].recommendation)
        assertEquals(CaptureAppRecommendation.NONE, ranked.last().recommendation)
    }

    @Test
    fun `공식 카탈로그 별칭으로 설치 앱을 검색한다`() {
        val result = CaptureAppPickerPolicy.filterAndSort(
            apps,
            CaptureOriginKind.CARD_APP,
            query = "삼성카드",
        )

        assertEquals(listOf("net.ib.android.smcard"), result.map { it.app.packageName })
    }

    @Test
    fun `표시명과 패키지를 대소문자 구분 없이 검색한다`() {
        val byLabel = CaptureAppPickerPolicy.filterAndSort(
            apps,
            CaptureOriginKind.PAYMENT_APP,
            query = "CARD 도우미",
        )
        val byPackage = CaptureAppPickerPolicy.filterAndSort(
            apps,
            CaptureOriginKind.PAYMENT_APP,
            query = "VIVA.REPUBLICA",
        )

        assertEquals(listOf("com.example.card"), byLabel.map { it.app.packageName })
        assertEquals(listOf("viva.republica.toss"), byPackage.map { it.app.packageName })
        assertEquals(CaptureAppRecommendation.OFFICIAL, byPackage.single().recommendation)
    }

    @Test
    fun `같은 패키지가 여러 런처 액티비티로 보여도 한 번만 남긴다`() {
        val duplicated = apps + InstalledCaptureApp("COM.EXAMPLE.CARD", "중복")

        val result = CaptureAppPickerPolicy.filterAndSort(
            duplicated,
            CaptureOriginKind.CARD_APP,
            query = "",
        )

        assertEquals(1, result.count { it.app.packageName.equals("com.example.card", true) })
        assertTrue(result.any { it.app.packageName == "com.example.notes" })
    }
}
