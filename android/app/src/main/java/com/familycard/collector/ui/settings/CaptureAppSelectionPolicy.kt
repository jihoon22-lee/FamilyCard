package com.familycard.collector.ui.settings

import com.familycard.collector.capture.CaptureFilter
import com.familycard.collector.capture.CaptureSourceRules

enum class AppSelectionRejection {
    INVALID_PACKAGE,
    FAMILYCARD_ITSELF,
    KAKAO_TALK,
    DEFAULT_SMS_APP,
}

/** 전체 알림을 노출할 위험이 큰 앱은 앱 선택 목록에서 제외하고 등록도 거부한다. */
object CaptureAppSelectionPolicy {
    fun rejectionFor(
        selectedPackage: String,
        familyCardPackage: String,
        defaultSmsPackage: String?,
    ): AppSelectionRejection? = when {
        CaptureSourceRules.normalizePackageName(selectedPackage) == null ->
            AppSelectionRejection.INVALID_PACKAGE

        selectedPackage == familyCardPackage -> AppSelectionRejection.FAMILYCARD_ITSELF
        selectedPackage == CaptureFilter.KAKAO_PACKAGE -> AppSelectionRejection.KAKAO_TALK
        selectedPackage == defaultSmsPackage -> AppSelectionRejection.DEFAULT_SMS_APP
        else -> null
    }
}
