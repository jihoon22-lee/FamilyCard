package com.familycard.collector.ui.settings

import com.familycard.collector.capture.CaptureFilter
import com.familycard.collector.capture.CaptureSourceRules

enum class AppSelectionRejection {
    INVALID_PACKAGE,
    FAMILYCARD_ITSELF,
    KAKAO_TALK,
    DEFAULT_SMS_APP,
}

/** 전체 알림을 노출할 위험이 큰 앱은 시스템 선택기에서 골라도 등록하지 않는다. */
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
