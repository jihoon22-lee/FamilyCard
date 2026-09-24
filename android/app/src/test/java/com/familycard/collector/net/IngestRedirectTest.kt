package com.familycard.collector.net

import com.sun.net.httpserver.HttpServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

class IngestRedirectTest {
    @Test fun `이동 응답을 따라 원문과 토큰을 전송하지 않고 실제 HTTP 번호를 보고한다`() {
        val targetRequests = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/ingest") { exchange ->
            exchange.requestBody.use { it.readBytes() }
            exchange.responseHeaders.add("Location", "/unexpected-destination")
            exchange.sendResponseHeaders(302, -1)
            exchange.close()
        }
        server.createContext("/unexpected-destination") { exchange ->
            targetRequests.incrementAndGet()
            exchange.sendResponseHeaders(500, -1)
            exchange.close()
        }
        server.start()
        try {
            val client = IngestClient("http://127.0.0.1:${server.address.port}", "synthetic-token")
            val error = assertThrows(IngestException::class.java) { client.upload(emptyList()) }
            assertEquals(302, error.statusCode)
            assertEquals(0, targetRequests.get())
        } finally {
            server.stop(0)
        }
    }
}
