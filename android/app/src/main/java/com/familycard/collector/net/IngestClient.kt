package com.familycard.collector.net

import com.familycard.collector.queue.PendingMessage
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

enum class IngestItemStatus { ACCEPTED, DUPLICATE, REJECTED }

data class IngestItemResult(
    val clientMessageId: String,
    val status: IngestItemStatus,
    val reason: String?,
)

data class IngestResponse(
    val accepted: Int,
    val duplicates: Int,
    val rejected: Int,
    val results: List<IngestItemResult>,
) {
    fun total(): Int = accepted + duplicates + rejected
}

/** `POST /api/ingest` 클라이언트. 원문은 어떤 오류 메시지나 로그에도 넣지 않는다. */
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

        fun buildRequestBody(messages: List<PendingMessage>): String {
            val array = JSONArray()
            messages.forEach { message ->
                array.put(
                    JSONObject().apply {
                        put("clientMessageId", message.clientMessageId)
                        put("source", message.source)
                        put("originKind", message.originKind)
                        put("packageName", message.packageName)
                        put("title", message.title)
                        put("body", message.body)
                        put("receivedAt", formatIso8601(message.receivedAt))
                    },
                )
            }
            return JSONObject().put("messages", array).toString()
        }

        /** 필드 누락·음수·알 수 없는 상태는 프로토콜 오류로 처리한다. */
        fun parseResponse(json: String): IngestResponse {
            try {
                val obj = JSONObject(json)
                val accepted = obj.getInt("accepted")
                val duplicates = obj.getInt("duplicates")
                val rejected = obj.getInt("rejected")
                if (accepted < 0 || duplicates < 0 || rejected < 0) {
                    throw IngestProtocolException("응답 건수는 음수일 수 없습니다")
                }

                val rawResults = obj.getJSONArray("results")
                val results = buildList {
                    for (index in 0 until rawResults.length()) {
                        val item = rawResults.getJSONObject(index)
                        val clientMessageId = item.getString("clientMessageId")
                        if (clientMessageId.isBlank()) {
                            throw IngestProtocolException("응답의 clientMessageId가 비어 있습니다")
                        }
                        val status = when (item.getString("status")) {
                            "accepted" -> IngestItemStatus.ACCEPTED
                            "duplicate" -> IngestItemStatus.DUPLICATE
                            "rejected" -> IngestItemStatus.REJECTED
                            else -> throw IngestProtocolException("알 수 없는 항목 상태입니다")
                        }
                        add(
                            IngestItemResult(
                                clientMessageId = clientMessageId,
                                status = status,
                                reason = item.optString("reason").ifBlank { null },
                            ),
                        )
                    }
                }

                return IngestResponse(accepted, duplicates, rejected, results)
            } catch (error: JSONException) {
                throw IngestProtocolException("서버 응답 형식이 올바르지 않습니다", error)
            }
        }

        fun formatIso8601(epochMillis: Long): String {
            val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            return format.format(Date(epochMillis))
        }
    }
}

class IngestException(message: String, val statusCode: Int) : Exception(message)
class IngestProtocolException(message: String, cause: Throwable? = null) : Exception(message, cause)
