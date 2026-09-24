package com.familycard.collector.queue

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

class UploadDiagnosticsTest {
    @Test fun `HTTP 응답 번호를 보존해 전송 경로 문제를 구분한다`() {
        for (code in listOf(301, 307, 400, 401, 403, 404, 405, 413, 429, 500, 502, 503, 504)) {
            val text = UploadDiagnostics.httpFailure(code)
            assertTrue(text.contains("HTTP $code"))
            assertTrue(text.contains("큐"))
        }
        assertTrue(UploadDiagnostics.httpFailure(404).contains("경로"))
        assertTrue(UploadDiagnostics.httpFailure(401).contains("인증"))
        assertTrue(UploadDiagnostics.httpFailure(307).contains("주소 이동"))
    }

    @Test fun `연결 오류 종류만 표시하며 원문 토큰 주소 예외 메시지는 노출하지 않는다`() {
        val secret = "synthetic-private-body-and-token"
        val errors = listOf(UnknownHostException(secret), SocketTimeoutException(secret),
            SSLHandshakeException(secret), ConnectException(secret), IllegalStateException(secret))
        for (error in errors) {
            val text = UploadDiagnostics.connectionFailure(error)
            assertFalse(text.contains(secret))
            assertTrue(text.contains("큐"))
        }
        assertTrue(UploadDiagnostics.connectionFailure(errors[0]).contains("주소"))
        assertTrue(UploadDiagnostics.connectionFailure(errors[1]).contains("시간"))
        assertTrue(UploadDiagnostics.connectionFailure(errors[2]).contains("보안 연결"))
    }
}
