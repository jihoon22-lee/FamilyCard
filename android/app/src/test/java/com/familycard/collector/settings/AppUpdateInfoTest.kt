package com.familycard.collector.settings

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

class AppUpdateInfoTest {
    private fun payload(): JSONObject = JSONObject().put("applicationId", "com.familycard.collector")
        .put("versionCode", 8).put("versionName", "test-version").put("sha256", "a".repeat(64))

    @Test fun `reads version and hash from published metadata`() {
        assertEquals(8, AppUpdateInfo.parse(payload().toString()).versionCode)
    }

    @Test fun `rejects other packages fractional versions and invalid hashes`() {
        for (value in listOf(payload().put("applicationId", "com.example.other"),
            payload().put("versionCode", 8.5), payload().put("versionCode", 0),
            payload().put("sha256", "invalid"), payload().put("versionName", "bad\nname"))) {
            assertThrows(Exception::class.java) { AppUpdateInfo.parse(value.toString()) }
        }
    }

    @Test fun `does not follow redirects or accept oversized metadata`() {
        val followed = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var oversized = false
        server.createContext("/downloads/familycard.json") { exchange ->
            if (oversized) {
                val body = "x".repeat(5000).toByteArray()
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            } else {
                exchange.responseHeaders.add("Location", "/other")
                exchange.sendResponseHeaders(302, -1)
            }
            exchange.close()
        }
        server.createContext("/other") { exchange ->
            followed.incrementAndGet()
            exchange.sendResponseHeaders(500, -1)
            exchange.close()
        }
        server.start()
        try {
            val origin = "http://127.0.0.1:${server.address.port}"
            assertThrows(Exception::class.java) { AppUpdateInfo.fetch(origin, true) }
            assertEquals(0, followed.get())
            oversized = true
            assertThrows(Exception::class.java) { AppUpdateInfo.fetch(origin, true) }
        } finally { server.stop(0) }
    }
}
