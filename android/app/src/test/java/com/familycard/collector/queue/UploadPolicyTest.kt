package com.familycard.collector.queue

import com.familycard.collector.net.IngestResponse
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 큐 삭제 판단 테스트.
 *
 * 이 판단이 틀리면 결제 알림이 **영구히** 사라진다. 카드사는 알림을 다시
 * 보내주지 않는다.
 */
class UploadPolicyTest {

    @Test
    fun `서버가 보낸 개수를 전부 설명하면 지운다`() {
        assertTrue(UploadPolicy.shouldDeleteBatch(3, IngestResponse(accepted = 3, duplicates = 0, rejected = 0)))
        assertTrue(UploadPolicy.shouldDeleteBatch(3, IngestResponse(accepted = 1, duplicates = 1, rejected = 1)))
        // 전부 중복이어도 서버가 다 설명한 것이므로 지운다 — 재전송한 배치다.
        assertTrue(UploadPolicy.shouldDeleteBatch(2, IngestResponse(accepted = 0, duplicates = 2, rejected = 0)))
    }

    @Test
    fun `★ 응답 개수가 모자라면 지우지 않는다`() {
        // 서버가 일부만 처리했다. 지우면 그 차이만큼 영구 유실된다.
        assertFalse(UploadPolicy.shouldDeleteBatch(3, IngestResponse(accepted = 2, duplicates = 0, rejected = 0)))
        assertFalse(UploadPolicy.shouldDeleteBatch(10, IngestResponse(accepted = 0, duplicates = 0, rejected = 0)))
    }

    @Test
    fun `응답 개수가 더 많아도 지우지 않는다`() {
        // 있을 수 없는 응답이다. 서버나 프로토콜이 어긋난 상황이므로
        // 안전한 쪽(보존)을 택한다.
        assertFalse(UploadPolicy.shouldDeleteBatch(2, IngestResponse(accepted = 3, duplicates = 0, rejected = 0)))
    }

    @Test
    fun `빈 배치는 지울 것이 없다`() {
        assertFalse(UploadPolicy.shouldDeleteBatch(0, IngestResponse(0, 0, 0)))
    }
}
