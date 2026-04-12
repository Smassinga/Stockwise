import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null

    @Input
    var target: String? = null

    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rootDir = File(project.projectDir, rootDirRel ?: throw GradleException("rootDirRel cannot be null"))
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val cargoTarget = cargoTargetTriple(target)
        val profile = if (release) "release" else "debug"
        val manifestPath = File(rootDir, "Cargo.toml").absolutePath

        val cargoArgs = mutableListOf(
            "build",
            "--package",
            "stockwise",
            "--manifest-path",
            manifestPath,
            "--target",
            cargoTarget,
            "--lib",
            "--features",
            "tauri/custom-protocol",
        )

        if (release) {
            cargoArgs.add("--release")
        }

        project.exec {
            workingDir(rootDir)
            executable("cargo")
            args(cargoArgs)
        }.assertNormalExitValue()

        val builtLibrary = File(rootDir, "target/$cargoTarget/$profile/libstockwise_lib.so")
        if (!builtLibrary.exists()) {
            throw GradleException("Expected Android library was not produced: ${builtLibrary.absolutePath}")
        }

        val jniLibsDir = File(project.projectDir, "src/main/jniLibs/${abiDirectory(target)}")
        if (!jniLibsDir.exists()) {
            jniLibsDir.mkdirs()
        }

        Files.copy(
            builtLibrary.toPath(),
            File(jniLibsDir, builtLibrary.name).toPath(),
            StandardCopyOption.REPLACE_EXISTING,
        )
    }

    private fun cargoTargetTriple(target: String): String =
        when (target) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> throw GradleException("Unsupported Android target '$target'")
        }

    private fun abiDirectory(target: String): String =
        when (target) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> throw GradleException("Unsupported Android target '$target'")
        }
}
