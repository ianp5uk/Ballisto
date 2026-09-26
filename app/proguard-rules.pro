# R8 is enabled for release builds. The JavaScript bridge methods are only
# called by name from web/storage.js, so they must not be renamed or removed.
-keepattributes JavascriptInterface
-keepclassmembers class com.waysproperty.ballisto.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
