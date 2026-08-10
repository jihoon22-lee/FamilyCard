package com.familycard.collector.capture

/**
 * 화이트리스트 판정 — **이 앱에서 가장 중요한 코드다.**
 *
 * `NotificationListenerService` 는 폰에 오는 **모든** 알림을 본다. 카카오톡 개인
 * 대화, 메신저, 이메일, 전부다. 카드사 알림톡을 받으려면 `com.kakao.talk` 을
 * 화이트리스트에 넣어야 하는데, 여기서 필터가 새면 가족의 사생활이 통째로
 * 서버에 쌓인다.
 *
 * ### 왜 순수 함수인가
 *
 * 설계 문서(08-android-app)의 예시는 `shouldCapture(sbn: StatusBarNotification)`
 * 형태였다. 하지만 그러면 판정 로직이 안드로이드 프레임워크 타입에 묶여
 * **JVM 유닛 테스트로 검증할 수 없다.** 이 판정은 "카카오톡 일반 대화가 서버에
 * 올라가지 않는다"는 이 앱의 가장 중요한 보장을 지탱하므로 반드시 테스트로
 * 고정되어야 한다. 그래서 판정은 문자열만 받는 순수 함수로 두고, 안드로이드
 * 타입을 다루는 얇은 어댑터는 호출부(CardNotificationListener)에 둔다.
 *
 * → AGENTS.md 불변 규칙 4, docs/design/08-android-app.md
 */
object CaptureFilter {

    /**
     * 카드사 앱 패키지 화이트리스트.
     *
     * ⚠️ **실기기에서 확인한 값만 넣을 것.** 검색으로 알아낸 패키지명은
     * 부정확하고 앱이 바뀌면 달라진다. 확인 방법:
     * ```
     * adb shell pm list packages | grep -i card
     * ```
     * 아래는 실기기 확인 전까지의 **빈 목록**이다. 비어 있으면 카드사 앱
     * 알림이 하나도 안 잡히지만, 잘못된 패키지명을 넣어 엉뚱한 앱의 알림을
     * 수집하는 것보다 낫다. 놓친 알림은 명세서 대사(Phase 6)로 메울 수 있어도,
     * 한 번 수집된 남의 사생활은 되돌릴 수 없다.
     */
    val cardAppPackages: Set<String> = emptySet()

    const val KAKAO_PACKAGE = "com.kakao.talk"

    /**
     * 카카오톡 알림톡의 발신 프로필명이 카드사인지 판정하는 패턴.
     *
     * 제목 화이트리스트가 아니라 패턴 매칭인 이유: 알림톡 발신 프로필명이
     * 카드사마다 조금씩 다르고 바뀌기도 한다("신한카드", "신한 카드",
     * "신한카드 알림" 등).
     */
    private val CARD_SENDER_PATTERN =
        Regex("(신한|국민|KB|삼성|현대|롯데|하나|BC|비씨|농협|NH|우리|씨티|카카오뱅크|케이뱅크|토스)\\s*카드")

    /**
     * SMS 발신번호가 카드사 대표번호인지 판정.
     *
     * 번호는 하이픈 유무가 제각각이라 숫자만 남겨 비교한다.
     * ⚠️ 여기도 실기기에서 실제 수신 번호를 확인해 채워야 한다.
     */
    val cardSmsSenders: Set<String> = emptySet()

    /**
     * 알림을 수집할지 판정한다.
     *
     * @param packageName 알림을 띄운 앱의 패키지명
     * @param title       알림 제목 (없으면 빈 문자열)
     */
    fun shouldCaptureNotification(packageName: String, title: String): Boolean = when (packageName) {
        in cardAppPackages -> true
        // ★ 카카오톡은 제목이 카드사 패턴일 때만. 일반 대화는 여기서 걸러진다.
        KAKAO_PACKAGE -> CARD_SENDER_PATTERN.containsMatchIn(title)
        else -> false
    }

    /**
     * SMS 를 수집할지 판정한다.
     *
     * @param sender 발신번호 (하이픈이 섞여 있어도 됨). null 이면 수집하지 않는다.
     * @param body   본문
     */
    fun shouldCaptureSms(sender: String?, body: String): Boolean {
        if (sender == null) return false

        val digits = sender.filter(Char::isDigit)
        if (digits in cardSmsSenders) return true

        // 번호 목록이 아직 비어 있어도, 본문에 카드사 승인/취소 문구가 있으면
        // 받는다. 카드사 문자는 발신번호가 자주 바뀌기 때문이다.
        // 개인 문자를 빨아들이지 않도록 **카드사명 + 승인/취소 어휘를 함께**
        // 요구한다. 둘 중 하나만으로는 통과시키지 않는다.
        val looksLikeCardSender = CARD_SENDER_PATTERN.containsMatchIn(body)
        val looksLikeTransaction = TRANSACTION_KEYWORDS.any { it in body }
        return looksLikeCardSender && looksLikeTransaction
    }

    private val TRANSACTION_KEYWORDS = listOf("승인", "취소", "결제", "일시불", "할부")
}
