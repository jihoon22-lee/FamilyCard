package com.familycard.collector.capture

/**
 * 화이트리스트 판정 — **이 앱에서 가장 중요한 개인정보 경계다.**
 *
 * 프레임워크 타입을 받지 않는 순수 함수로 유지해, 개인정보 유출 방지 경계를
 * 에뮬레이터 없이 매 빌드마다 검증한다.
 */
object CaptureFilter {
    const val KAKAO_PACKAGE = "com.kakao.talk"

    /**
     * 패키지와 카카오 채널 제목은 정확히 일치해야 한다. 카카오톡은 앱 전체 등록을
     * 무시하고 사용자가 등록한 공식 채널 제목만 허용한다.
     */
    fun matchNotification(
        packageName: String,
        title: String,
        sources: List<CaptureSourceConfig>,
        blockedAppPackages: Set<String> = emptySet(),
    ): CaptureSourceConfig? {
        val normalizedPackage = packageName.trim()
        if (normalizedPackage in blockedAppPackages) return null
        if (normalizedPackage == KAKAO_PACKAGE) {
            val normalizedTitle = title.trim()
            return sources.firstOrNull {
                it.kind == CaptureOriginKind.KAKAO_CHANNEL && it.identifier == normalizedTitle
            }
        }

        return sources.firstOrNull {
            (it.kind == CaptureOriginKind.CARD_APP || it.kind == CaptureOriginKind.PAYMENT_APP) &&
                it.identifier == normalizedPackage
        }
    }

    /** SMS 본문을 결합하기 전에 발신자만으로 수집 대상 여부를 판정한다. */
    fun matchSmsSender(
        sender: String?,
        sources: List<CaptureSourceConfig>,
    ): CaptureSourceConfig? {
        val normalizedSender = CaptureSourceRules.normalizeSmsSender(sender) ?: return null
        return sources.firstOrNull {
            it.kind == CaptureOriginKind.SMS_SENDER && it.identifier == normalizedSender
        }
    }

    /** 등록된 발신자라도 광고 문자를 줄이기 위해 거래 어휘를 하나 이상 요구한다. */
    fun hasTransactionKeyword(body: String): Boolean = TRANSACTION_KEYWORDS.any { it in body }

    private val TRANSACTION_KEYWORDS = listOf("승인", "취소", "결제", "일시불", "할부", "사용")
}
