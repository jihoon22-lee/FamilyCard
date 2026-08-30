package com.familycard.collector.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppUpdateDownloadPolicyTest {
    @Test
    fun `HTTPS 서버에 버전과 캐시 방지값을 붙인다`() {
        assertEquals(
            "https://familycard.example.ts.net:3443/downloads/familycard.apk" +
                "?installed=3&request=1234",
            AppUpdateDownloadPolicy.buildUrl(
                "https://familycard.example.ts.net:3443/",
                allowInsecureLocalhost = false,
                installedVersionCode = 3,
                cacheBuster = 1234,
            ),
        )
    }

    @Test
    fun `운영 HTTP와 경로가 든 서버 주소는 거부한다`() {
        assertNull(
            AppUpdateDownloadPolicy.buildUrl("http://example.com", false, 3, 1),
        )
        assertNull(
            AppUpdateDownloadPolicy.buildUrl("https://example.com/path", false, 3, 1),
        )
    }

    @Test
    fun `디버그 localhost HTTP만 기존 주소 정책대로 허용한다`() {
        assertEquals(
            "http://localhost:3000/downloads/familycard.apk?installed=3&request=1",
            AppUpdateDownloadPolicy.buildUrl("http://localhost:3000", true, 3, 1),
        )
        assertNull(AppUpdateDownloadPolicy.buildUrl("http://192.168.0.10:3000", true, 3, 1))
    }
}
