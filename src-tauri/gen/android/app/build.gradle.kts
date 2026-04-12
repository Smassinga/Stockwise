import java.util.Properties
import org.gradle.api.GradleException

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun loadSimpleProperties(propFile: java.io.File): Map<String, String> {
    if (!propFile.exists()) {
        return emptyMap()
    }

    return propFile.readLines()
        .map(String::trim)
        .filter { line ->
            line.isNotEmpty() && !line.startsWith("#") && !line.startsWith("!")
        }
        .associate { line ->
            val separatorIndex = line.indexOf('=')
            if (separatorIndex < 0) {
                line to ""
            } else {
                line.substring(0, separatorIndex).trim() to line.substring(separatorIndex + 1).trim()
            }
        }
}

val keystoreProperties = loadSimpleProperties(rootProject.file("keystore.properties"))

fun signingValue(propertyName: String, envName: String): String? {
    val fileValue = keystoreProperties[propertyName]?.trim().orEmpty()
    if (fileValue.isNotEmpty()) {
        return fileValue
    }

    val envValue = System.getenv(envName)?.trim().orEmpty()
    return envValue.ifEmpty { null }
}

val releaseStoreFile = signingValue("storeFile", "STOCKWISE_ANDROID_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "STOCKWISE_ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "STOCKWISE_ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "STOCKWISE_ANDROID_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

android {
    compileSdk = 36
    namespace = "com.stockwise.app"
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.stockwise.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

gradle.taskGraph.whenReady {
    val releaseBuildRequested = allTasks.any { task ->
        task.path.contains("Release", ignoreCase = true)
    }

    if (releaseBuildRequested && !hasReleaseSigning) {
        throw GradleException(
            "Release Android builds require src-tauri/gen/android/keystore.properties or STOCKWISE_ANDROID_KEYSTORE_* environment variables.",
        )
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
