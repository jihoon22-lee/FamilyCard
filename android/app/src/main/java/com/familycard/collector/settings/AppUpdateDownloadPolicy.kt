package com.familycard.collector.settings

/** 설정된 FamilyCard 서버에서 같은 서명키의 APK를 받을 안정적인 주소를 만든다. */
object AppUpdateDownloadPolicy {
    const val DOWNLOAD_PATH = "/downloads/familycard.apk"

    fun buildUrl(
        rawServerUrl: String,
        allowInsecureLocalhost: Boolean,
        installedVersionCode: Int,
        cacheBuster: Long,
    ): String? {
        if (installedVersionCode < 1 || cacheBuster < 0) return null
        val serverUrl = ServerUrlPolicy.normalize(rawServerUrl, allowInsecureLocalhost) ?: return null
        return "$serverUrl$DOWNLOAD_PATH?installed=$installedVersionCode&request=$cacheBuster"
    }
}
