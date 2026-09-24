package com.familycard.collector.history

import java.util.concurrent.TimeUnit

enum class RcsReadResult(val summary: String) {
    COMPLETE("삼성 RCS 보관함 확인 완료"),
    UNSUPPORTED_DEVICE("이 기기는 삼성 RCS 가져오기를 지원하지 않습니다."),
    UNAVAILABLE("삼성 RCS 보관함에 접근할 수 없습니다."),
    DENIED("기기가 RCS 보관함 읽기를 허용하지 않습니다."),
    UNSUPPORTED_FORMAT("이 메시지 앱의 RCS 보관함 형식을 지원하지 않습니다."),
}

/** 지연 반영을 위해 하루를 겹쳐 읽고, 장기 중단 뒤에는 최대 7일씩 따라잡는다. */
object RcsAutoScan {
    val overlapMillis: Long = TimeUnit.DAYS.toMillis(1)
    val windowMillis: Long = TimeUnit.DAYS.toMillis(7)

    fun nextRange(since: Long, completedThrough: Long, now: Long): SmsHistoryRange? {
        require(since > 0 && completedThrough >= 0)
        // 폰 시계가 뒤로 이동하면 진행 시각을 되감거나 미래 데이터를 조회하지 않는다.
        if (now < since || completedThrough > now) return null
        val from = maxOf(since, completedThrough - overlapMillis)
        val through = minOf(now, from + windowMillis)
        return SmsHistoryRange(from, through)
    }

    /** 본문/큐 실패·중지·미지원에서는 해당 구간의 진행 시각을 전진시키지 않는다. */
    suspend fun catchUp(
        since: Long,
        completedThrough: Long,
        now: Long,
        checkActive: () -> Unit,
        collect: suspend (SmsHistoryRange) -> RcsReadResult,
        checkpoint: (Long) -> Unit,
    ): RcsReadResult? {
        var cursor = completedThrough
        do {
            checkActive()
            val range = nextRange(since, cursor, now) ?: return null
            val result = collect(range)
            if (result != RcsReadResult.COMPLETE) return result
            checkActive()
            checkpoint(range.through)
            cursor = range.through
        } while (cursor < now)
        return RcsReadResult.COMPLETE
    }
}
