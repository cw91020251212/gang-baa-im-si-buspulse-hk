package hk.buspulse.app

import android.app.*
import android.content.*
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.*
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var web: WebView
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        createChannel()
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.userAgentString += " BusPulseAndroid/1.0"
            addJavascriptInterface(AlarmBridge(this@MainActivity), "AndroidLocalAlarm")
            webViewClient = WebViewClient()
            loadUrl("https://cw91020251212.github.io/gang-baa-im-si-buspulse-hk/?android=1")
        }
        setContentView(web)
        requestPermissionsIfNeeded()
    }
    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("bus_arrival", "巴士到站提醒", NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(true) })
    }
    private fun requestPermissionsIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 40)
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            val alarm = getSystemService(AlarmManager::class.java)
            if (!alarm.canScheduleExactAlarms()) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }
    }
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
}

class AlarmBridge(private val context: Context) {
    @JavascriptInterface fun schedule(id: String, triggerAt: String, title: String, body: String) {
        val at = triggerAt.toLongOrNull() ?: return
        val alarm = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply { putExtra("title", title); putExtra("body", body); putExtra("id", id) }
        val request = id.hashCode() and 0x7fffffff
        val pi = PendingIntent.getBroadcast(context, request, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val prefs = context.getSharedPreferences("local_alarms", Context.MODE_PRIVATE)
        val route = id.substringBefore('|')
        val ids = prefs.getStringSet(route, emptySet())!!.toMutableSet(); ids.add(id)
        prefs.edit().putStringSet(route, ids).apply()
        if (android.os.Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
    @JavascriptInterface fun cancelRoute(routeId: String) {
        val alarm = context.getSystemService(AlarmManager::class.java)
        val prefs = context.getSharedPreferences("local_alarms", Context.MODE_PRIVATE)
        val ids = prefs.getStringSet(routeId, emptySet())?.toSet() ?: emptySet()
        ids.forEach { id ->
            val request = id.hashCode() and 0x7fffffff
            val pi = PendingIntent.getBroadcast(context, request, Intent(context, AlarmReceiver::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
            if (pi != null) { alarm.cancel(pi); pi.cancel() }
        }
        prefs.edit().remove(routeId).apply()
    }
}
