package com.familycard.collector.settings

import android.content.Context
import com.familycard.collector.history.RcsAutoScan
import java.util.UUID

data class RcsAutoState(
    val generation: String = "",
    val since: Long = 0,
    val completedThrough: Long = 0,
    val attemptedAt: Long = 0,
    val summary: String = "아직 자동 보충을 실행하지 않았습니다.",
    val warning: String = "",
) {
    val enabled: Boolean get() = generation.isNotBlank() && since > 0
}

/** 원문/발신자 없이 선택 상태와 완료한 조회 구간만 보관한다. 재활성화는 새 세대다. */
class RcsAutoSettings(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("familycard_rcs_auto", Context.MODE_PRIVATE)

    fun load(): RcsAutoState = synchronized(lock) {
        RcsAutoState(
            prefs.getString("generation", "").orEmpty(), prefs.getLong("since", 0),
            prefs.getLong("completed_through", 0), prefs.getLong("attempted_at", 0),
            prefs.getString("summary", "아직 자동 보충을 실행하지 않았습니다.").orEmpty(),
            prefs.getString("warning", "").orEmpty(),
        )
    }

    fun enable(now: Long) = synchronized(lock) {
        check(prefs.edit().clear()
            .putString("generation", UUID.randomUUID().toString())
            .putLong("since", maxOf(1, now - RcsAutoScan.overlapMillis))
            .putString("summary", "자동 보충 예약 중")
            .commit())
    }

    fun disable() = synchronized(lock) {
        check(prefs.edit().putString("generation", "").putString("summary", "자동 보충 꺼짐").commit())
    }

    /** 끄기 또는 끈 뒤 다시 켜기와 경합하는 이전 작업은 저장/상태 갱신도 중단한다. */
    fun <T> whileCurrent(generation: String, action: () -> T): T = synchronized(lock) {
        if (!load().enabled || load().generation != generation) {
            throw kotlinx.coroutines.CancellationException("RCS automatic capture disabled or replaced")
        }
        action()
    }

    fun attempted(generation: String, now: Long) = whileCurrent(generation) {
        check(prefs.edit().putLong("attempted_at", now).putString("summary", "등록 발신자의 RCS 확인 중").commit())
    }

    fun checkpoint(generation: String, through: Long) = whileCurrent(generation) {
        check(prefs.edit().putLong("completed_through", maxOf(through, load().completedThrough)).commit())
    }

    fun summary(generation: String, message: String) = whileCurrent(generation) {
        check(prefs.edit().putString("summary", message).commit())
    }

    fun warnOversized(generation: String) = whileCurrent(generation) {
        check(prefs.edit().putString("warning", "크기 제한으로 보관하지 못한 RCS가 있습니다. 원본은 문자 앱에 남아 있습니다.").commit())
    }

    private companion object { val lock = Any() }
}
