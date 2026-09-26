plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.waysproperty.ballisto"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.waysproperty.ballisto"
        // Android 10 floor as requested; also covers current GrapheneOS and
        // LineageOS builds. No Google Play Services or other Google libraries.
        minSdk = 29
        targetSdk = 34
        versionCode = 2
        versionName = "1.0.1"
    }

    // The whole user interface and the ballistic solver are the shared web app
    // in ../web (also usable unchanged in an iOS WKWebView). It is packaged as
    // the APK's assets; nothing is downloaded at run time.
    sourceSets {
        getByName("main") {
            assets.srcDirs(rootProject.file("web"))
        }
    }

    signingConfigs {
        create("release") {
            storeFile = file("../keystore/ballisto-release.keystore")
            storePassword = System.getenv("BALLISTO_KEYSTORE_PASSWORD") ?: "ballisto"
            keyAlias = "ballisto"
            keyPassword = System.getenv("BALLISTO_KEY_PASSWORD") ?: "ballisto"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Self-signed for direct / F-Droid-style sideload distribution.
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // Reproducible, dependency-free APK: no Google dependency-info metadata blob.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

// Deliberately no dependencies beyond the Kotlin standard library (Apache-2.0):
// the app uses only the Android framework's own Activity and WebView.
