package com.familycard.collector.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlPolicyTest {
    @Test
    fun `release는 경로 없는 HTTPS origin만 허용한다`() {
        assertEquals(
            "https://familycard.example.ts.net",
            ServerUrlPolicy.normalize("https://familycard.example.ts.net/", false),
        )
        assertNull(ServerUrlPolicy.normalize("http://familycard.example.ts.net", false))
        assertNull(ServerUrlPolicy.normalize("https://familycard.example.ts.net/path", false))
        assertNull(ServerUrlPolicy.normalize("https://user@familycard.example.ts.net", false))
    }

    @Test
    fun `debug는 로컬 호스트 HTTP만 추가로 허용한다`() {
        assertEquals("http://localhost:3000", ServerUrlPolicy.normalize("http://localhost:3000", true))
        assertNull(ServerUrlPolicy.normalize("http://192.168.0.10:3000", true))
    }

    @Test
    fun `WebView는 scheme과 port까지 같은 origin만 내부에서 연다`() {
        val base = "https://familycard.example.ts.net"
        assertTrue(ServerUrlPolicy.isSameOrigin(base, "$base/raw"))
        assertTrue(ServerUrlPolicy.isSameOrigin(base, "https://FAMILYCARD.example.ts.net:443/raw"))
        assertFalse(ServerUrlPolicy.isSameOrigin(base, "http://familycard.example.ts.net/raw"))
        assertFalse(ServerUrlPolicy.isSameOrigin(base, "https://familycard.example.ts.net:8443/raw"))
        assertFalse(ServerUrlPolicy.isSameOrigin(base, "https://evil.example/raw"))
    }
}
