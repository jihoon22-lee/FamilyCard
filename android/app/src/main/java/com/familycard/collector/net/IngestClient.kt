package com.familycard.collector.net

import com.familycard.collector.queue.PendingMessage
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** `POST /api/ingest` 응답. */
data class IngestResponse(val accepted: Int, val duplicates: Int, val rejected: Int) {
    fun total(): Int = accepted + duplicates + rejected
}

/**
 * 서버 수집 엔드포인트 클라이언트.
 *
 * OkHttp 대신 `HttpURLConnection` 을 쓴다. 요청이 단순(POST 한 종류)하고
 * 의존성을 하나라도 줄이는 편이 APK 크기와 버전 관리 모두에 낫다.
 */
class IngestClient(private val serverUrl: String, private val deviceToken: String) {

    fun upload(messages: List<PendingMessage>): IngestResponse {
        val connection = (URL("${serverUrl.trimEnd('/')}/api/ingest").openConnection() as HttpURLConnection)
        return try {
            connection.apply {
                requestMethod = "POST"
                setRequestProperty("Authorization", "Bearer $deviceToken")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doOutput = true
            }

            connection.outputStream.use { it.write(buildRequestBody(messages).toByteArray()) }

            val code = connection.responseCode
            if (code != HttpURLConnection.HTTP_OK) {
                // 본문을 로그에 남기지 않는다. 상태 코드만.
                throw IngestException("서버가 $code 로 응답했습니다", code)
            }

            parseResponse(connection.inputStream.bufferedReader().readText())
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 30_000

        /**
         * 요청 본문을 만든다. 순수 함수라 유닛 테스트가 가능하다.
         *
         * `memberId` 를 보내지 않는 것이 중요하다 — 소유자는 서버가 디바이스
         * 토큰에서 유도한다. 클라이언트가 주장하는 소유자를 서버가 믿으면
         * 남의 데이터에 쓰기가 가능해진다.
         */
        fun buildRequestBody(messages: List<PendingMessage>): String {
            val array = JSONArray()
            messages.forEach { message ->
                array.put(
                    JSONObject().apply {
                        put("source", message.source)
                        put("packageName", message.packageName)
                        put("title", message.title)
                        put("body", message.body)
                        put("receivedAt", formatIso8601(message.receivedAt))
                    },
                )
            }
            return JSONObject().put("messages", array).toString()
        }

        fun parseResponse(json: String): IngestResponse {
            val obj = JSONObject(json)
            return IngestResponse(
                accepted = obj.optInt("accepted", 0),
                duplicates = obj.optInt("duplicates", 0),
                rejected = obj.optInt("rejected", 0),
            )
        }

        /** epoch millis → UTC ISO-8601. 서버가 파싱할 수 있는 형식이어야 한다. */
        fun formatIso8601(epochMillis: Long): String {
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            return format.format(Date(epochMillis))
        }
    }
}

class IngestException(message: String, val statusCode: Int) : Exception(message)
