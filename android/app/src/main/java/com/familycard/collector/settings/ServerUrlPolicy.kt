package com.familycard.collector.settings

import java.net.URI

/** 서버 주소와 WebView 이동 경계를 한 곳에서 검증한다. */
object ServerUrlPolicy {
    /**
     * release에서는 경로 없는 HTTPS origin만 허용한다. debug의 로컬 개발에
     * 한해 localhost 계열의 HTTP를 허용한다.
     */
    fun normalize(raw: String, allowInsecureLocalhost: Boolean): String? {
        val uri = parse(raw.trim()) ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null

        if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        if (uri.path != null && uri.path.isNotEmpty() && uri.path != "/") return null

        val secure = scheme == "https"
        val localDebug = allowInsecureLocalhost && scheme == "http" && host in LOCAL_DEBUG_HOSTS
        if (!secure && !localDebug) return null

        return URI(scheme, null, host, uri.port, null, null, null).toString()
    }

    /** 후보 URL이 기준 서버와 scheme·host·port까지 같은지 확인한다. */
    fun isSameOrigin(baseUrl: String, candidateUrl: String): Boolean {
        val base = parse(baseUrl) ?: return false
        val candidate = parse(candidateUrl) ?: return false
        return base.scheme.equals(candidate.scheme, ignoreCase = true) &&
            base.host.equals(candidate.host, ignoreCase = true) &&
            effectivePort(base) == effectivePort(candidate)
    }

    private fun parse(value: String): URI? = runCatching { URI(value) }.getOrNull()

    private fun effectivePort(uri: URI): Int = when {
        uri.port >= 0 -> uri.port
        uri.scheme.equals("https", ignoreCase = true) -> 443
        uri.scheme.equals("http", ignoreCase = true) -> 80
        else -> -1
    }

    private val LOCAL_DEBUG_HOSTS = setOf("localhost", "127.0.0.1", "10.0.2.2")
}
