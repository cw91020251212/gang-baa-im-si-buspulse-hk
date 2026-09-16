# BusPulse HK Android 本地鬧鐘版

呢個 App 用同一個 BusPulse HK 網頁界面，但收到 ETA 後會經 `AndroidLocalAlarm` JavaScript bridge 呼叫 Android `AlarmManager`。到點由 `AlarmReceiver` 發出本地通知，唔需要網絡或網頁 JavaScript 繼續運行。

## 建置

需要 Android SDK、JDK 17、Gradle 8.9 或 Android Studio。開啟 `android-app/`，同步 Gradle 後建立 APK。

Android 13 會要求通知權限；Android 12 或以上會檢查精準鬧鐘權限。App 內仍然使用 GitHub Pages 的現有界面及 ETA API，只有到點提醒改用 Android 原生鬧鐘。
