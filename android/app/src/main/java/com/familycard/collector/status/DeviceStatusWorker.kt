package com.familycard.collector.status

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.familycard.collector.BuildConfig
import com.familycard.collector.queue.QueueDatabase
import com.familycard.collector.settings.AppSettings
import com.familycard.collector.settings.RcsAutoSettings
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/** Independent from ingestion: reporting cannot delete or delay captured messages. */
class DeviceStatusWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val settings = AppSettings(applicationContext)
        if (!settings.isConfigured) return@withContext Result.success()
        try {
            val queue = QueueDatabase.getInstance(applicationContext)
            val rcs = RcsAutoSettings(applicationContext).load()
            val snapshot = DeviceStatusPayload(
                versionCode = BuildConfig.VERSION_CODE,
                pending = queue.pendingCount(), rejected = queue.rejectedCount(),
                sampledAt = System.currentTimeMillis(), lastQueuedAt = settings.lastQueuedAt,
                lastUploadAttemptAt = settings.lastUploadAttemptAt, lastUploadAt = settings.lastUploadAt,
                rcsAttemptedAt = rcs.attemptedAt, rcsCompletedThrough = rcs.completedThrough,
                rcsEnabled = rcs.enabled,
                notificationGranted = applicationContext.packageName in NotificationManagerCompat.getEnabledListenerPackages(applicationContext),
                smsGranted = granted(Manifest.permission.RECEIVE_SMS),
                smsReadGranted = granted(Manifest.permission.READ_SMS),
            )
            val code = DeviceStatusClient(settings.serverUrl, settings.deviceToken).send(snapshot)
            if (code == 200) {
                settings.lastStatusReportAt = System.currentTimeMillis()
                settings.lastStatusReportFailed = false
                Result.success()
            } else {
                settings.lastStatusReportFailed = true
                // Permanent responses don't end future periodic runs, and never touch the queue.
                if (code == 429 || code >= 500) Result.retry() else Result.success()
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            settings.lastStatusReportFailed = true
            Result.retry()
        }
    }

    private fun granted(permission: String): Boolean =
        applicationContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    companion object {
        fun schedule(context: Context) {
            val work = PeriodicWorkRequestBuilder<DeviceStatusWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "familycard-device-status", ExistingPeriodicWorkPolicy.KEEP, work,
            )
        }
    }
}
