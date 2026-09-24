import java.io.File
import java.security.MessageDigest
import groovy.json.JsonOutput
import org.gradle.api.GradleException
import org.gradle.api.tasks.Copy

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

val keystoreFilePath = providers.environmentVariable("KEYSTORE_FILE").orNull?.takeIf(String::isNotBlank)
val keystorePassword = providers.environmentVariable("KEYSTORE_PASSWORD").orNull?.takeIf(String::isNotBlank)
val keyAliasValue = providers.environmentVariable("KEY_ALIAS").orNull?.takeIf(String::isNotBlank)
val keyPasswordValue = providers.environmentVariable("KEY_PASSWORD").orNull?.takeIf(String::isNotBlank)
val releaseSigningConfigured = listOf(
    keystoreFilePath,
    keystorePassword,
    keyAliasValue,
    keyPasswordValue,
).all { it != null }

android {
    namespace = "com.familycard.collector"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.familycard.collector"
        minSdk = 26
        targetSdk = 36
        versionCode = 7
        versionName = "0.2.0"
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = rootProject.file(requireNotNull(keystoreFilePath))
                storePassword = keystorePassword
                keyAlias = keyAliasValue
                keyPassword = keyPasswordValue
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }
}

val verifyReleaseSigningConfigured = tasks.register("verifyReleaseSigningConfigured") {
    doLast {
        if (!releaseSigningConfigured) {
            throw GradleException(
                "릴리스 서명 정보가 없습니다. KEYSTORE_FILE, KEYSTORE_PASSWORD, " +
                    "KEY_ALIAS, KEY_PASSWORD를 모두 설정하세요.",
            )
        }
        val signingFile = rootProject.file(requireNotNull(keystoreFilePath))
        if (!signingFile.isFile) {
            throw GradleException("KEYSTORE_FILE이 가리키는 서명 파일을 찾을 수 없습니다.")
        }
    }
}

tasks.matching { it.name == "assembleRelease" || it.name == "bundleRelease" }.configureEach {
    dependsOn(verifyReleaseSigningConfigured)
}

fun writeApkMetadata(apk: File, target: File, code: Int, name: String) {
    val digest = MessageDigest.getInstance("SHA-256")
    apk.inputStream().use { input ->
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
    }
    target.parentFile.mkdirs()
    target.writeText(JsonOutput.toJson(mapOf(
        "applicationId" to "com.familycard.collector", "versionCode" to code, "versionName" to name,
        "sha256" to digest.digest().joinToString("") { "%02x".format(it) },
    )))
}

tasks.register("writeDebugApkMetadata") {
    dependsOn("assembleDebug")
    doLast {
        writeApkMetadata(
            layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile,
            layout.buildDirectory.file("outputs/apk/debug/familycard.json").get().asFile,
            requireNotNull(android.defaultConfig.versionCode), requireNotNull(android.defaultConfig.versionName),
        )
    }
}

/** 최종 업데이트 때만 실행: APK와 그 APK의 메타데이터를 함께 게시한다. */
tasks.register<Copy>("publishDebugApk") {
    dependsOn("writeDebugApkMetadata")
    from(layout.buildDirectory.dir("outputs/apk/debug")) {
        include("app-debug.apk", "familycard.json")
    }
    into(rootProject.layout.projectDirectory.dir("../web/public/downloads"))
    rename("app-debug.apk", "familycard.apk")
}

// CI release artifact와 서버 다운로드에 동일한 APK 해시/버전 메타데이터를 포함한다.
tasks.register("writeReleaseApkMetadata") {
    dependsOn("assembleRelease")
    doLast {
        val apk = layout.buildDirectory.dir("outputs/apk/release").get().asFile
            .listFiles()?.singleOrNull { it.extension == "apk" }
            ?: throw GradleException("릴리스 APK가 정확히 하나여야 합니다.")
        writeApkMetadata(apk, File(apk.parentFile, "familycard.json"),
            requireNotNull(android.defaultConfig.versionCode), requireNotNull(android.defaultConfig.versionName))
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.work.runtime.ktx)

    testImplementation(libs.junit)
    testImplementation("org.robolectric:robolectric:4.17")
    // org.json 은 안드로이드 프레임워크에 있지만 JVM 유닛 테스트 클래스패스에서는
    // 예외만 던지는 스텁이다. 테스트에서 실제 구현을 쓰려고 명시적으로 넣는다.
    testImplementation(libs.json)
}
