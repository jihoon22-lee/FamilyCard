package com.familycard.collector.capture

/**
 * 실기기에서 직접 확인한 수집 대상만 담는다.
 *
 * 기본값은 의도적으로 모두 비어 있다. 검색 결과나 카드사명 정규식으로 대상을
 * 추측하면 같은 이름을 쓰는 카카오톡 일반 대화나 개인 SMS를 저장할 수 있다.
 * 실제 기기에서 패키지명·알림톡 채널 제목·SMS 발신번호를 확인한 뒤에만 이
 * 목록을 채운다. → AGENTS.md 불변 규칙 4
 */
data class CaptureAllowlist(
    val cardAppPackages: Set<String>,
    val kakaoChannelTitles: Set<String>,
    /** 하이픈을 제거한 숫자만 저장한다. */
    val cardSmsSenders: Set<String>,
)

object VerifiedCaptureAllowlist {
    val value = CaptureAllowlist(
        cardAppPackages = emptySet(),
        kakaoChannelTitles = emptySet(),
        cardSmsSenders = emptySet(),
    )
}

/**
 * 화이트리스트 판정 — **이 앱에서 가장 중요한 코드다.**
 *
 * 프레임워크 타입을 받지 않는 순수 함수로 유지해, 개인정보 유출 방지 경계를
 * 에뮬레이터 없이 매 빌드마다 검증한다.
 */
object CaptureFilter {
    const val KAKAO_PACKAGE = "com.kakao.talk"

    /**
     * 알림을 수집할지 판정한다. 패키지와 채널 제목은 정확히 일치해야 한다.
     * 앞뒤 공백만 제거하고 부분 일치나 정규식 추정은 하지 않는다.
     */
    fun shouldCaptureNotification(
        packageName: String,
        title: String,
        allowlist: CaptureAllowlist = VerifiedCaptureAllowlist.value,
    ): Boolean {
        val normalizedPackage = packageName.trim()
        return when {
            normalizedPackage in allowlist.cardAppPackages -> true
            normalizedPackage == KAKAO_PACKAGE -> title.trim() in allowlist.kakaoChannelTitles
            else -> false
        }
    }

    /**
     * SMS는 확인된 발신번호와 거래 어휘를 **모두** 만족해야 한다.
     *
     * 발신번호를 아직 확인하지 못했을 때 본문만으로 추정하는 fallback은 두지
     * 않는다. 개인 문자의 본문은 카드사명·승인 같은 단어를 얼마든지 포함할 수
     * 있기 때문이다.
     */
    fun shouldCaptureSms(
        sender: String?,
        body: String,
        allowlist: CaptureAllowlist = VerifiedCaptureAllowlist.value,
    ): Boolean {
        val normalizedSender = sender?.filter(Char::isDigit).orEmpty()
        if (normalizedSender.isEmpty() || normalizedSender !in allowlist.cardSmsSenders) {
            return false
        }

        return TRANSACTION_KEYWORDS.any { it in body }
    }

    private val TRANSACTION_KEYWORDS = listOf("승인", "취소", "결제", "일시불", "할부", "사용")
}
