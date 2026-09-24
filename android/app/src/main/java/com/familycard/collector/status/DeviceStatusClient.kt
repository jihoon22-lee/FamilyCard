package com.familycard.collector.status

import java.net.HttpURLConnection
import java.net.URL

class DeviceStatusClient(private val serverUrl: String, private val token: String) {
    fun send(payload: DeviceStatusPayload): Int {
        val connection = URL("${serverUrl.trimEnd('/')}/api/device-status").openConnection() as HttpURLConnection
        return try {
            connection.apply {
                requestMethod = "POST"
                instanceFollowRedirects = false
                connectTimeout = 10_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            connection.outputStream.use { it.write(payload.json().toByteArray(Charsets.UTF_8)) }
            connection.responseCode
        } finally { connection.disconnect() }
    }
}
