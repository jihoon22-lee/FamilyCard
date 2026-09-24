package com.familycard.collector.settings

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Public release metadata only. Android verifies the actual downloaded APK signature. */
data class AppUpdateInfo(val versionCode: Int, val versionName: String, val sha256: String) {
    companion object {
        fun parse(body: String): AppUpdateInfo {
            require(body.length <= 4096)
            val json = JSONObject(body)
            require(json.getString("applicationId") == "com.familycard.collector")
            val code = json.get("versionCode")
            require(code is Number && code.toLong() in 1..Int.MAX_VALUE && code.toDouble() == code.toLong().toDouble())
            val name = json.getString("versionName")
            require(name.isNotBlank() && name.length <= 80 && name.none { it.isISOControl() })
            val hash = json.getString("sha256")
            require(Regex("[a-f0-9]{64}").matches(hash))
            return AppUpdateInfo(code.toInt(), name, hash)
        }

        fun fetch(server: String, allowInsecureLocalhost: Boolean): AppUpdateInfo {
            val origin = requireNotNull(ServerUrlPolicy.normalize(server, allowInsecureLocalhost))
            val connection = URL("$origin/downloads/familycard.json?request=${System.currentTimeMillis()}")
                .openConnection() as HttpURLConnection
            return try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.useCaches = false
                require(connection.responseCode == 200)
                val bytes = connection.inputStream.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(1024)
                    while (output.size() <= 4096) {
                        val count = input.read(buffer, 0, minOf(buffer.size, 4097 - output.size()))
                        if (count < 0) break
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
                require(bytes.size <= 4096)
                parse(bytes.toString(Charsets.UTF_8))
            } finally { connection.disconnect() }
        }
    }
}
