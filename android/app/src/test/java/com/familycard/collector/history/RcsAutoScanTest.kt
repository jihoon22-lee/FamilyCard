package com.familycard.collector.history

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class RcsAutoScanTest {
    private val now = 1_800_000_000_000L
    private val day = TimeUnit.DAYS.toMillis(1)

    @Test fun `최초 실행은 동의한 최근 하루 범위만 확인한다`() = runBlocking {
        val seen = mutableListOf<SmsHistoryRange>()
        val saved = mutableListOf<Long>()
        assertEquals(RcsReadResult.COMPLETE, RcsAutoScan.catchUp(now - day, 0, now, {},
            { seen += it; RcsReadResult.COMPLETE }, saved::add))
        assertEquals(listOf(SmsHistoryRange(now - day, now)), seen)
        assertEquals(listOf(now), saved)
    }

    @Test fun `장기 중단 뒤에는 빈틈 없이 제한된 구간씩 따라잡는다`() = runBlocking {
        val seen = mutableListOf<SmsHistoryRange>()
        val saved = mutableListOf<Long>()
        RcsAutoScan.catchUp(now - 46 * day, now - 45 * day, now, {},
            { seen += it; RcsReadResult.COMPLETE }, saved::add)
        assertTrue(seen.size > 1)
        assertEquals(now - 46 * day, seen.first().from)
        assertEquals(now, seen.last().through)
        assertTrue(seen.all { it.through - it.from <= 7 * day })
        assertTrue(seen.zipWithNext().all { (a, b) -> b.from == a.through - day && b.through > a.through })
        assertTrue(saved.zipWithNext().all { (a, b) -> b > a })
    }

    @Test fun `실패한 구간은 완료 처리하지 않고 다음 실행에서 다시 읽는다`() = runBlocking {
        val since = now - 20 * day
        var checkpoint = 0L
        var calls = 0
        var failedRange: SmsHistoryRange? = null
        try {
            RcsAutoScan.catchUp(since, checkpoint, now, {}, {
                calls++
                if (calls == 2) { failedRange = it; error("synthetic queue failure") }
                RcsReadResult.COMPLETE
            }, { checkpoint = it })
            fail("failure must propagate")
        } catch (_: IllegalStateException) { }
        assertEquals(since + 7 * day, checkpoint)
        val resumed = mutableListOf<SmsHistoryRange>()
        RcsAutoScan.catchUp(since, checkpoint, now, {}, { resumed += it; RcsReadResult.COMPLETE }, { checkpoint = it })
        assertEquals(failedRange, resumed.first())
        assertEquals(now, checkpoint)
    }

    @Test fun `권한 거부와 미지원은 조회 위치를 전진시키지 않는다`() = runBlocking {
        for (result in RcsReadResult.entries.filter { it != RcsReadResult.COMPLETE }) {
            var calls = 0
            assertEquals(result, RcsAutoScan.catchUp(now - 20 * day, 0, now, {},
                { calls++; result }, { error("must not checkpoint") }))
            assertEquals(1, calls)
        }
    }

    @Test fun `읽기 중 사용자가 끄면 완료 구간도 기록하지 않는다`() = runBlocking {
        var active = true
        try {
            RcsAutoScan.catchUp(now - day, 0, now,
                { if (!active) throw CancellationException("disabled") },
                { active = false; RcsReadResult.COMPLETE },
                { error("must not checkpoint after disabling") })
            fail("must cancel")
        } catch (_: CancellationException) { }
    }

    @Test fun `조회 자체의 중지는 성공이나 진행 시각으로 바꾸지 않는다`() = runBlocking {
        try {
            RcsAutoScan.catchUp(now - day, 0, now, {},
                { throw CancellationException("synthetic cancellation") }, { error("must not checkpoint") })
            fail("must cancel")
        } catch (_: CancellationException) { }
    }

    @Test fun `시계가 뒤로 이동하면 보관함을 읽거나 진행을 되감지 않는다`() = runBlocking {
        assertNull(RcsAutoScan.catchUp(now - day, now, now - 1, {},
            { error("clock moved backwards") }, { error("must not checkpoint") }))
        assertNull(RcsAutoScan.nextRange(now, 0, now - 1))
    }

    @Test fun `다음 주기는 하루를 겹쳐 지연 반영된 원문을 재확인한다`() {
        assertEquals(SmsHistoryRange(now - day, now + 900_000),
            RcsAutoScan.nextRange(now - 30 * day, now, now + 900_000))
    }
}
