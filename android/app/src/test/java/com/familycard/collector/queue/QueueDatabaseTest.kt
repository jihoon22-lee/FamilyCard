package com.familycard.collector.queue

import android.app.Application
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class QueueDatabaseTest {
    private lateinit var queue: QueueDatabase

    @Before fun setup() {
        val context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("familycard_queue.db")
        queue = QueueDatabase(context)
    }

    @After fun close() { queue.close() }

    private fun sample(id: String = "test-event"): PendingMessage = PendingMessage(
        clientMessageId = id, source = "RCS", originKind = "SMS_SENDER",
        packageName = "00112233", title = "테스트 카드", body = "가공 원문\n".repeat(1000),
        receivedAt = 1_780_000_000_000L,
    )

    private fun reject(message: PendingMessage, reason: String = "body_too_long") {
        queue.enqueue(message)
        val pending = queue.takeBatch(200).first { it.clientMessageId == message.clientMessageId }
        queue.applyUploadPlan(UploadPlan(emptyList(), listOf(QuarantinedPendingMessage(pending, reason))), 100L)
    }

    @Test fun `retry retains original event and body then accepted removes pending`() {
        val original = sample()
        reject(original)
        val id = queue.rejectedPage().single().id
        assertEquals(0, queue.pendingCount())
        assertTrue(queue.retryRejected(id))
        assertFalse(queue.retryRejected(id))
        val pending = queue.takeBatch(1).single()
        assertEquals(original, pending.copy(id = 0))
        assertEquals(0, queue.rejectedCount())
        queue.applyUploadPlan(UploadPlan(listOf(pending.id), emptyList()), 200L)
        assertEquals(0, queue.pendingCount())
    }

    @Test fun `retry rejected again preserves original and new reason`() {
        val original = sample()
        reject(original)
        queue.retryRejected(queue.rejectedPage().single().id)
        val pending = queue.takeBatch(1).single()
        queue.applyUploadPlan(UploadPlan(emptyList(), listOf(QuarantinedPendingMessage(pending, "invalid_body"))), 200L)
        val row = queue.rejectedPage().single()
        assertEquals("invalid_body", row.reason)
        assertEquals(200L, row.rejectedAt)
        assertEquals(original, queue.rejectedMessage(row.id)!!.copy(id = 0))
    }

    @Test fun `pending insert failure rolls back rejected removal`() {
        reject(sample())
        val id = queue.rejectedPage().single().id
        queue.writableDatabase.execSQL("CREATE TRIGGER fail_insert BEFORE INSERT ON pending_message BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        assertThrows(Exception::class.java) { queue.retryRejected(id) }
        assertEquals(1, queue.rejectedCount())
        assertEquals(0, queue.pendingCount())
        assertEquals(sample().body, queue.rejectedMessage(id)!!.body)
    }

    @Test fun `conflicting event id never destroys either original`() {
        reject(sample())
        val id = queue.rejectedPage().single().id
        queue.enqueue(sample().copy(body = "다른 가공 원문"))
        assertThrows(IllegalStateException::class.java) { queue.retryRejected(id) }
        assertEquals(sample().body, queue.rejectedMessage(id)!!.body)
        assertEquals("다른 가공 원문", queue.takeBatch(1).single().body)
    }

    @Test fun `already pending identical event can safely leave quarantine`() {
        reject(sample())
        queue.enqueue(sample())
        assertTrue(queue.retryRejected(queue.rejectedPage().single().id))
        assertEquals(1, queue.pendingCount())
        assertEquals(0, queue.rejectedCount())
    }

    @Test fun `failed quarantine insert does not delete pending batch`() {
        queue.enqueue(sample())
        val pending = queue.takeBatch(1).single()
        queue.writableDatabase.execSQL("CREATE TRIGGER fail_insert BEFORE INSERT ON rejected_message BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        assertThrows(Exception::class.java) {
            queue.applyUploadPlan(UploadPlan(emptyList(), listOf(QuarantinedPendingMessage(pending, "invalid_body"))), 100L)
        }
        assertEquals(1, queue.pendingCount())
        assertEquals(sample().body, queue.takeBatch(1).single().body)
    }

    @Test fun `quarantine pages are bounded and cover all without duplicates`() {
        repeat(43) { reject(sample("event-$it")) }
        val first = queue.rejectedPage()
        val second = queue.rejectedPage(first.last().id)
        val third = queue.rejectedPage(second.last().id)
        assertEquals(listOf(20, 20, 3), listOf(first.size, second.size, third.size))
        assertEquals(43, (first + second + third).map { it.id }.toSet().size)
    }
}
