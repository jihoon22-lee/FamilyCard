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
        versionCode = 3
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

/** 로컬 디버그 APK를 현재 FamilyCard 개발 서버의 고정 다운로드 경로에 게시한다. */
tasks.register<Copy>("publishDebugApk") {
    dependsOn("assembleDebug")
    from(layout.buildDirectory.file("outputs/apk/debug/app-debug.apk"))
    into(rootProject.layout.projectDirectory.dir("../web/public/downloads"))
    rename { "familycard.apk" }
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
    // org.json 은 안드로이드 프레임워크에 있지만 JVM 유닛 테스트 클래스패스에서는
    // 예외만 던지는 스텁이다. 테스트에서 실제 구현을 쓰려고 명시적으로 넣는다.
    testImplementation(libs.json)
}
