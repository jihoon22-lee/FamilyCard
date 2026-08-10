package com.familycard.collector

import android.app.Application
import com.familycard.collector.queue.UploadWorker

class FamilyCardApp : Application() {
    override fun onCreate() {
        super.onCreate()
        UploadWorker.schedule(this)
    }
}
