package com.familycard.collector.ui.settings

import com.familycard.collector.capture.CaptureOriginKind
import java.util.Locale

/** 홈 화면에서 실행할 수 있는 앱 중 선택기에 표시할 최소 정보. 서버나 디스크에 저장하지 않는다. */
data class InstalledCaptureApp(
    val packageName: String,
    val label: String,
)

data class RecommendedCaptureApp(
    val packageName: String,
    val kind: CaptureOriginKind,
    val priority: Int,
    val aliases: List<String>,
)

enum class CaptureAppRecommendation {
    OFFICIAL,
    KEYWORD,
    NONE,
}

data class RankedCaptureApp(
    val app: InstalledCaptureApp,
    val recommendation: CaptureAppRecommendation,
    val catalogPriority: Int?,
)

/**
 * 공식 Google Play 패키지를 추천 정렬·검색 별칭에만 사용한다.
 *
 * 이 목록은 화이트리스트가 아니다. 목록에 있어도 사용자가 직접 선택해야 수집 대상이 되며,
 * 목록에 없는 앱도 검색해 등록할 수 있다. 출처와 확인일은
 * docs/research/android-finance-app-catalog.md 에 기록한다.
 */
object CaptureAppCatalog {
    val entries: List<RecommendedCaptureApp> = listOf(
        RecommendedCaptureApp(
            "com.shcard.smartpay",
            CaptureOriginKind.CARD_APP,
            10,
            listOf("신한 SOL페이", "신한카드", "SOL Pay"),
        ),
        RecommendedCaptureApp(
            "com.kbcard.cxh.appcard",
            CaptureOriginKind.CARD_APP,
            20,
            listOf("KB Pay", "KB국민카드", "국민카드"),
        ),
        RecommendedCaptureApp(
            "net.ib.android.smcard",
            CaptureOriginKind.CARD_APP,
            30,
            listOf("모니모", "삼성카드", "Samsung Card"),
        ),
        RecommendedCaptureApp(
            "com.hyundaicard.appcard",
            CaptureOriginKind.CARD_APP,
            40,
            listOf("현대카드", "Hyundai Card"),
        ),
        RecommendedCaptureApp(
            "com.lcacApp",
            CaptureOriginKind.CARD_APP,
            50,
            listOf("디지로카", "롯데카드", "Lotte Card"),
        ),
        RecommendedCaptureApp(
            "com.hanaskcard.paycla",
            CaptureOriginKind.CARD_APP,
            60,
            listOf("하나Pay", "하나카드", "Hana Card"),
        ),
        RecommendedCaptureApp(
            "nh.smart.nhallonepay",
            CaptureOriginKind.CARD_APP,
            70,
            listOf("NH pay", "NH농협카드", "농협카드"),
        ),
        RecommendedCaptureApp(
            "com.wooricard.smartapp",
            CaptureOriginKind.CARD_APP,
            80,
            listOf("우리WON카드", "우리카드", "Woori Card"),
        ),
        RecommendedCaptureApp(
            "kvp.jjy.MispAndroid320",
            CaptureOriginKind.CARD_APP,
            90,
            listOf("페이북", "BC카드", "비씨카드", "ISP"),
        ),
        RecommendedCaptureApp(
            "viva.republica.toss",
            CaptureOriginKind.PAYMENT_APP,
            10,
            listOf("토스", "Toss"),
        ),
        RecommendedCaptureApp(
            "com.kakaopay.app",
            CaptureOriginKind.PAYMENT_APP,
            20,
            listOf("카카오페이", "Kakao Pay"),
        ),
        RecommendedCaptureApp(
            "com.naverfin.payapp",
            CaptureOriginKind.PAYMENT_APP,
            30,
            listOf("네이버페이", "Naver Pay", "Npay"),
        ),
        RecommendedCaptureApp(
            "com.nhnent.payapp",
            CaptureOriginKind.PAYMENT_APP,
            40,
            listOf("PAYCO", "페이코"),
        ),
        RecommendedCaptureApp(
            "com.samsung.android.spay",
            CaptureOriginKind.PAYMENT_APP,
            50,
            listOf("삼성 월렛", "삼성페이", "Samsung Wallet", "Samsung Pay"),
        ),
        RecommendedCaptureApp(
            "com.elevenst.skpay",
            CaptureOriginKind.PAYMENT_APP,
            60,
            listOf("11pay", "11페이", "SK pay", "SK페이"),
        ),
        RecommendedCaptureApp(
            "com.lottemembers.android",
            CaptureOriginKind.PAYMENT_APP,
            70,
            listOf("L.POINT with L.PAY", "L.PAY", "엘페이", "엘포인트"),
        ),
        RecommendedCaptureApp(
            "com.ssg.serviceapp.android.egiftcertificate",
            CaptureOriginKind.PAYMENT_APP,
            80,
            listOf("SSGPAY", "SSG PAY", "쓱페이"),
        ),
        RecommendedCaptureApp(
            "com.rainist.banksalad2",
            CaptureOriginKind.PAYMENT_APP,
            90,
            listOf("뱅크샐러드", "Banksalad", "자산관리"),
        ),
    )

    private val byPackage = entries.associateBy { it.packageName.lowercase(Locale.ROOT) }

    fun find(packageName: String): RecommendedCaptureApp? =
        byPackage[packageName.lowercase(Locale.ROOT)]
}

/** 검색과 추천 순서를 Android 프레임워크 밖에서 결정해 JVM 테스트로 고정한다. */
object CaptureAppPickerPolicy {
    private val priorityKeywords = listOf("카드", "card", "페이", "pay", "월렛", "wallet")

    fun filterAndSort(
        installedApps: List<InstalledCaptureApp>,
        targetKind: CaptureOriginKind,
        query: String,
    ): List<RankedCaptureApp> {
        val normalizedQuery = query.trim().lowercase(Locale.ROOT)

        return installedApps
            .distinctBy { it.packageName.lowercase(Locale.ROOT) }
            .mapNotNull { app ->
                val catalog = CaptureAppCatalog.find(app.packageName)
                val searchable = buildSearchableText(app, catalog)
                if (normalizedQuery.isNotEmpty() && normalizedQuery !in searchable) {
                    return@mapNotNull null
                }

                val official = catalog?.takeIf { it.kind == targetKind }
                val recommendation = when {
                    official != null -> CaptureAppRecommendation.OFFICIAL
                    priorityKeywords.any { it in app.label.lowercase(Locale.ROOT) } ->
                        CaptureAppRecommendation.KEYWORD

                    else -> CaptureAppRecommendation.NONE
                }
                RankedCaptureApp(app, recommendation, official?.priority)
            }
            .sortedWith(
                compareBy<RankedCaptureApp> { it.recommendation.ordinal }
                    .thenBy { it.catalogPriority ?: Int.MAX_VALUE }
                    .thenBy { it.app.label.lowercase(Locale.KOREAN) }
                    .thenBy { it.app.packageName.lowercase(Locale.ROOT) },
            )
    }

    private fun buildSearchableText(
        app: InstalledCaptureApp,
        catalog: RecommendedCaptureApp?,
    ): String = buildList {
        add(app.label)
        add(app.packageName)
        catalog?.aliases?.let(::addAll)
    }.joinToString(" ").lowercase(Locale.ROOT)
}
