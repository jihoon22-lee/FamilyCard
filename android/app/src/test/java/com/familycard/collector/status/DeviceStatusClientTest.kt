package com.familycard.collector.status

import com.sun.net.httpserver.HttpServer
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

class DeviceStatusClientTest {
    @Test fun `redirect never sends device token to another path`() {
        val targetRequests = AtomicInteger(0)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device-status") { exchange ->
            exchange.requestBody.use { it.readBytes() }
            exchange.responseHeaders.add("Location", "/unexpected")
            exchange.sendResponseHeaders(307, -1)
            exchange.close()
        }
        server.createContext("/unexpected") { exchange ->
            targetRequests.incrementAndGet()
            exchange.sendResponseHeaders(500, -1)
            exchange.close()
        }
        server.start()
        try {
            val client = DeviceStatusClient("http://127.0.0.1:${server.address.port}", "synthetic-token")
            val payload = DeviceStatusPayload(7, 0, 0, 0, 0, 0, 0, 0, 0, false, false, false, false)
            assertEquals(307, client.send(payload))
            assertEquals(0, targetRequests.get())
        } finally { server.stop(0) }
    }
}
