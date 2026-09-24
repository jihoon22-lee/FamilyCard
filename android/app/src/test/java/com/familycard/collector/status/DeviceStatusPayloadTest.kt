package com.familycard.collector.status

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DeviceStatusPayloadTest {
    @Test fun `wire payload is bounded numeric metadata without free text`() {
        val body = DeviceStatusPayload(7, 4, 2, 1_800_000_000_000L, 0, 0, 0, 0, 0, false, true, false, false).json()
        val json = JSONObject(body)
        assertEquals(14, json.length())
        assertEquals(1, json.getInt("protocol"))
        assertEquals(4, json.getInt("pending"))
        assertEquals(2, json.getInt("rejected"))
        assertFalse(json.getBoolean("rcsEnabled"))
        json.keys().forEach { key -> assertTrue(json.get(key) is Number || json.get(key) is Boolean) }
        assertTrue(body.toByteArray().size < 4096)
    }
}
