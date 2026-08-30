package com.familycard.collector.capture

import java.util.Locale

/** 서버의 CaptureOriginKind enum과 동일한 wire 값이다. */
enum class CaptureOriginKind(val wireValue: String) {
    CARD_APP("CARD_APP"),
    PAYMENT_APP("PAYMENT_APP"),
    KAKAO_CHANNEL("KAKAO_CHANNEL"),
    SMS_SENDER("SMS_SENDER"),
    /** v2 로컬 큐와 기존 서버 원문의 보존 마이그레이션에만 사용한다. */
    UNKNOWN_APP("UNKNOWN_APP"),
    ;

    val isUserManaged: Boolean
        get() = this != UNKNOWN_APP

    companion object {
        fun fromWireValue(value: String): CaptureOriginKind? =
            entries.firstOrNull { it.wireValue == value }
    }
}

/** 사용자가 FamilyCard 안에서 직접 등록한 수집 대상. 표시명은 폰 안에만 보관한다. */
data class CaptureSourceConfig(
    val kind: CaptureOriginKind,
    val identifier: String,
    val displayName: String,
)

/** 입력 정규화와 저장 가능 여부를 한곳에서 강제한다. 잘못된 값은 fail-closed로 버린다. */
object CaptureSourceRules {
    const val MAX_PACKAGE_LENGTH = 255
    const val MAX_CHANNEL_TITLE_LENGTH = 500
    const val MAX_SMS_SENDER_LENGTH = 100
    const val MAX_DISPLAY_NAME_LENGTH = 100

    private val packagePattern = Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$")

    fun normalize(
        kind: CaptureOriginKind,
        identifier: String,
        displayName: String,
    ): CaptureSourceConfig? {
        if (!kind.isUserManaged) return null

        val normalizedIdentifier = when (kind) {
            CaptureOriginKind.CARD_APP,
            CaptureOriginKind.PAYMENT_APP,
            -> normalizePackageName(identifier)

            CaptureOriginKind.KAKAO_CHANNEL -> normalizeKakaoChannelTitle(identifier)
            CaptureOriginKind.SMS_SENDER -> normalizeSmsSender(identifier)
            CaptureOriginKind.UNKNOWN_APP -> null
        } ?: return null

        val normalizedName = displayName.trim().ifEmpty { normalizedIdentifier }
        if (
            normalizedName.length > MAX_DISPLAY_NAME_LENGTH ||
            normalizedName.any(Char::isISOControl)
        ) {
            return null
        }

        return CaptureSourceConfig(kind, normalizedIdentifier, normalizedName)
    }

    fun normalizePackageName(value: String): String? {
        val normalized = value.trim()
        return normalized.takeIf {
            it.length in 1..MAX_PACKAGE_LENGTH &&
                !it.any(Char::isISOControl) &&
                packagePattern.matches(it)
        }
    }

    fun normalizeKakaoChannelTitle(value: String): String? {
        val normalized = value.trim()
        return normalized.takeIf {
            it.length in 1..MAX_CHANNEL_TITLE_LENGTH && !it.any(Char::isISOControl)
        }
    }

    /**
     * 숫자 발신번호와 영문 발신자 ID를 모두 지원한다. 화면에 보이는 하이픈·괄호·공백은
     * 발신 측과 사용자 입력이 달라도 같은 값으로 비교할 수 있게 제거한다.
     */
    fun normalizeSmsSender(value: String?): String? {
        val normalized = value
            ?.trim()
            ?.filterNot { it.isWhitespace() || it == '-' || it == '(' || it == ')' || it == '+' }
            ?.uppercase(Locale.ROOT)
            .orEmpty()
        return normalized.takeIf {
            it.length in 1..MAX_SMS_SENDER_LENGTH && !it.any(Char::isISOControl)
        }
    }

    /** 앱은 패키지 기준, 나머지는 종류+식별자 기준으로 중복 등록을 막는다. */
    fun identityKey(source: CaptureSourceConfig): String = when (source.kind) {
        CaptureOriginKind.CARD_APP,
        CaptureOriginKind.PAYMENT_APP,
        -> "APP:${source.identifier}"

        else -> "${source.kind.wireValue}:${source.identifier}"
    }
}
