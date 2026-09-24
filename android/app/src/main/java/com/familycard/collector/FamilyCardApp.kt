package com.familycard.collector

import android.app.Application
import com.familycard.collector.queue.UploadWorker
import com.familycard.collector.status.DeviceStatusWorker
import com.familycard.collector.history.RcsAutoWorker

class FamilyCardApp : Application() {
    override fun onCreate() {
        super.onCreate()
        UploadWorker.schedule(this)
        DeviceStatusWorker.schedule(this)
        RcsAutoWorker.restore(this)
    }
}
