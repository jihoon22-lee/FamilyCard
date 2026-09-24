package com.familycard.collector.queue

/** 원문 없는 목록 정보. 본문은 개별 상세를 열 때만 읽는다. */
data class RejectedMessageSummary(
    val id: Long,
    val source: String,
    val receivedAt: Long,
    val rejectedAt: Long,
    val reason: String,
)
