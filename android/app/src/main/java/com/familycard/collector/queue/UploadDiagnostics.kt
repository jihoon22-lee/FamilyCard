package com.familycard.collector.queue

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/** 원문, 토큰, 주소가 포함될 수 있는 예외 메시지는 사용자/로그에 전달하지 않는다. */
object UploadDiagnostics {
    fun httpFailure(status: Int): String = when (status) {
        401, 403 -> "인증 실패 (HTTP $status) — 기기 토큰을 확인해주세요. 큐는 유지됩니다."
        400, 413 -> "요청 오류 (HTTP $status) — 앱·서버 확인이 필요합니다. 큐는 유지됩니다."
        in 300..399 -> "서버 주소 이동 응답 (HTTP $status) — 설정한 서버 주소를 확인해주세요. 큐는 유지됩니다."
        404, 405 -> "전송 경로 오류 (HTTP $status) — 설정한 서버 주소를 확인해주세요. 큐는 유지됩니다."
        else -> "서버 오류 (HTTP $status) — 큐 유지 후 재시도 예정"
    }

    fun connectionFailure(error: Exception): String = when (error) {
        is UnknownHostException -> "서버 주소를 찾지 못했습니다. Tailscale 연결과 서버 주소를 확인해주세요. 큐는 유지됩니다."
        is SocketTimeoutException -> "서버 응답 시간이 초과됐습니다. 큐 유지 후 재시도 예정"
        is SSLException -> "보안 연결에 실패했습니다. 폰의 날짜·시간과 서버 인증서를 확인해주세요. 큐는 유지됩니다."
        is ConnectException -> "서버에 연결하지 못했습니다. Tailscale 연결과 서버 상태를 확인해주세요. 큐는 유지됩니다."
        else -> "전송 연결 실패 — 큐 유지 후 재시도 예정"
    }
}
