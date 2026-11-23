param(
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$JdkPath = $env:JAVA_HOME
)

$ErrorActionPreference = 'Stop'

if (!$SdkPath -or !$JdkPath) {
    throw 'Renseigne ANDROID_HOME et JAVA_HOME, ou passe -SdkPath et -JdkPath.'
}
$env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkPath).Path
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkPath).Path

$keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
$buildTools = Join-Path $env:ANDROID_HOME 'build-tools/35.0.0'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
foreach ($tool in @($keytool, $zipalign, $apksigner)) {
    if (!(Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Outil introuvable : $tool" }
}

& (Join-Path $PSScriptRoot 'gradlew.bat') -p $PSScriptRoot --no-daemon lintRelease assembleRelease
if ($LASTEXITCODE -ne 0) { throw 'La compilation Android a échoué.' }

$release = Join-Path $PSScriptRoot 'app/build/outputs/apk/release'
$metadata = Get-Content -LiteralPath (Join-Path $release 'output-metadata.json') -Raw | ConvertFrom-Json
$output = $metadata.elements | Select-Object -First 1
$distribution = Join-Path $PSScriptRoot 'build/distribution'
$null = New-Item -ItemType Directory -Path $distribution -Force
$aligned = Join-Path $distribution 'ficodutch-aligned-unsigned.apk'
$signed = Join-Path $distribution 'ficodutch-signed-pending.apk'
$apk = Join-Path $distribution "FicoDutch-$($output.versionName).apk"

$signing = Join-Path $PSScriptRoot '.signing'
$null = New-Item -ItemType Directory -Path $signing -Force
$keystore = Join-Path $signing 'ficodutch.p12'
$passwordFile = Join-Path $signing 'password.dpapi'
$hasKeystore = Test-Path -LiteralPath $keystore
if ($hasKeystore -ne (Test-Path -LiteralPath $passwordFile)) {
    throw 'Le dossier .signing est incomplet. Restaure la clé et son mot de passe pour signer une mise à jour.'
}

$oldPassword = [Environment]::GetEnvironmentVariable('FICODUTCH_APK_PASSWORD')
try {
    if ($hasKeystore) {
        $password = Get-Content -LiteralPath $passwordFile -Raw | ConvertTo-SecureString
        $env:FICODUTCH_APK_PASSWORD = [Net.NetworkCredential]::new('', $password).Password
    } else {
        $bytes = New-Object byte[] 24
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $env:FICODUTCH_APK_PASSWORD = [Convert]::ToBase64String($bytes)
        & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -alias ficodutch `
            -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=FicoDutch Android' `
            -storepass:env FICODUTCH_APK_PASSWORD -keypass:env FICODUTCH_APK_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'La création de la clé Android a échoué.' }
        ConvertTo-SecureString $env:FICODUTCH_APK_PASSWORD -AsPlainText -Force |
            ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile -NoNewline
    }

    & $zipalign -P 16 -f 4 (Join-Path $release $output.outputFile) $aligned
    if ($LASTEXITCODE -ne 0) { throw "L’alignement de l’APK a échoué." }
    & $apksigner sign --ks $keystore --ks-key-alias ficodutch --ks-pass env:FICODUTCH_APK_PASSWORD --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw "La signature de l’APK a échoué." }
    & $apksigner verify --verbose $signed
    if ($LASTEXITCODE -ne 0) { throw 'La vérification de la signature a échoué.' }

    Move-Item -LiteralPath $signed -Destination $apk -Force
    Get-FileHash -LiteralPath $apk -Algorithm SHA256
} finally {
    [Environment]::SetEnvironmentVariable('FICODUTCH_APK_PASSWORD', $oldPassword)
    foreach ($temporary in @($aligned, $signed, "$signed.idsig")) {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}
