# Add project specific ProGuard rules here.
-keep class com.sjtu.canvas.helper.data.** { *; }
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn okhttp3.**
-dontwarn retrofit2.**
