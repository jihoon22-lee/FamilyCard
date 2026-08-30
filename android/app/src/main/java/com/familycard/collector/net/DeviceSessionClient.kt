package com.familycard.collector.net

import org.json.JSONObject
import com.familycard.collector.settings.ServerUrlPolicy
import java.net.HttpURLConnection
import java.net.URL

/**
 * 디바이스 토큰 → 1회용 세션 URL 교환.
 *
 * WebView 에 디바이스 토큰을 직접 실어 보내지 않는 이유: URL 은 로그·브라우저
 * 히스토리·리퍼러에 남는데 디바이스 토큰은 **장기 자격증명**이라 한 번 새면
 * 폐기할 때까지 계속 유효하다. 서버가 돌려주는 nonce 는 60초 만료 1회용이라
 * 유출돼도 거의 쓸모없다.
 */
class DeviceSessionClient(private val serverUrl: String, private val deviceToken: String) {

    /** 성공하면 WebView 에 로드할 URL, 실패하면 null. */
    fun requestSessionUrl(): String? {
        val connection =
            (URL("${serverUrl.trimEnd('/')}/api/auth/device-session").openConnection() as HttpURLConnection)
        return try {
            connection.apply {
                requestMethod = "POST"
                setRequestProperty("Authorization", "Bearer $deviceToken")
                connectTimeout = 15_000
                readTimeout = 15_000
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
            val url = JSONObject(connection.inputStream.bufferedReader().readText())
                .optString("url")
                .ifEmpty { return null }
            url.takeIf { ServerUrlPolicy.isSameOrigin(serverUrl, it) }
        } catch (_: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
