package com.familycard.collector.queue

import com.familycard.collector.net.IngestResponse

/**
 * 업로드 후 큐를 비울지 판단한다.
 *
 * 로직을 워커에서 떼어낸 이유: 이 판단이 틀리면 **결제 알림이 영구히
 * 사라진다.** 카드사는 알림을 다시 보내주지 않는다. 안드로이드 런타임 없이
 * 유닛 테스트로 고정할 수 있어야 한다.
 */
object UploadPolicy {

    /**
     * 서버가 보낸 개수를 전부 설명했을 때만 지운다.
     *
     * HTTP 200 만 보고 지우면 안 된다 — 서버가 일부만 처리했을 수 있다.
     * `accepted + duplicates + rejected` 가 보낸 개수와 같아야 "전부 처리됨"이
     * 성립한다.
     *
     * 서버는 멱등하므로(dedupeHash) 애매하면 **지우지 않고 재전송하는 쪽**이
     * 항상 안전하다. 중복은 서버가 걸러주지만 유실은 되돌릴 수 없다.
     */
    fun shouldDeleteBatch(sentCount: Int, response: IngestResponse): Boolean =
        sentCount > 0 && response.total() == sentCount
}
