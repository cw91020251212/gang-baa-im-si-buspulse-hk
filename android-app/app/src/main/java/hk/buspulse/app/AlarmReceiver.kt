package hk.buspulse.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, "bus_arrival")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(intent.getStringExtra("title") ?: "巴士就嚟到站")
            .setContentText(intent.getStringExtra("body") ?: "巴士到站提醒")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true).setContentIntent(open).setDefaults(NotificationCompat.DEFAULT_ALL).build()
        context.getSystemService(NotificationManager::class.java).notify((intent.getStringExtra("id") ?: "bus").hashCode(), notification)
    }
}
