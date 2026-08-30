package com.familycard.collector.settings

import android.content.Context
import com.familycard.collector.BuildConfig

/**
 * 서버 주소와 디바이스 토큰 보관.
 *
 * 토큰은 장기 자격증명이라 유출되면 폐기할 때까지 계속 유효하다. 안드로이드의
 * 앱별 private SharedPreferences 는 다른 앱이 읽을 수 없다(루팅된 기기 제외).
 * 루팅까지 방어하려면 EncryptedSharedPreferences 가 필요한데, 그건 별도
 * 의존성이고 키스토어 이슈가 따라온다 — 분실 시 대응은 "웹에서 기기 폐기"로
 * 설계돼 있으므로(07-auth-scope) 지금은 여기까지로 둔다.
 */
class AppSettings(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trim().trimEnd('/')).apply()

    var deviceToken: String
        get() = prefs.getString(KEY_DEVICE_TOKEN, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value.trim()).apply()

    var lastUploadAt: Long
        get() = prefs.getLong(KEY_LAST_UPLOAD_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_UPLOAD_AT, value).apply()

    /** 마지막 전송 결과 요약. **본문은 절대 담지 않는다** — 건수와 상태만. */
    var lastUploadSummary: String
        get() = prefs.getString(KEY_LAST_SUMMARY, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_LAST_SUMMARY, value).apply()

    /** 원문을 로컬 큐에 넣지 못한 마지막 오류. 원문 자체는 담지 않는다. */
    var lastCaptureError: String
        get() = prefs.getString(KEY_LAST_CAPTURE_ERROR, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_LAST_CAPTURE_ERROR, value).apply()

    var lastCaptureErrorAt: Long
        get() = prefs.getLong(KEY_LAST_CAPTURE_ERROR_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_CAPTURE_ERROR_AT, value).apply()

    val isConfigured: Boolean
        get() = ServerUrlPolicy.normalize(serverUrl, BuildConfig.DEBUG) != null && deviceToken.isNotEmpty()

    private companion object {
        const val NAME = "familycard_settings"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_DEVICE_TOKEN = "device_token"
        const val KEY_LAST_UPLOAD_AT = "last_upload_at"
        const val KEY_LAST_SUMMARY = "last_upload_summary"
        const val KEY_LAST_CAPTURE_ERROR = "last_capture_error"
        const val KEY_LAST_CAPTURE_ERROR_AT = "last_capture_error_at"
    }
}
