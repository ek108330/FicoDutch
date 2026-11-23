# FicoDutch pour Android

L’application installe FicoDutch sur Android 10 et versions ultérieures. Elle affiche le jeu en plein écran de l’application et se connecte aux mêmes Hubs que la version web. Un accès à Internet est nécessaire. Le jeu se met à jour avec le site de préproduction.

## Installer l’APK

1. Transfère `FicoDutch-1.0.0.apk` sur ton téléphone Android, puis ouvre-le dans **Fichiers**.
2. Si Android le demande, autorise l’installation depuis **Fichiers** pour terminer l’installation.
3. Ouvre **FicoDutch** depuis l’écran des applications.

## Compiler l’application

Installe un JDK 17 et le SDK Android avec la plateforme **API 36** et les **Build Tools 35.0.0**. [Outils Android](https://developer.android.com/tools)

Depuis la racine du dépôt, lance la commande avec ton JDK et ton SDK Android configurés dans `JAVA_HOME` et `ANDROID_HOME`.

```powershell
.\android\build-apk.ps1
```

Le script génère et vérifie l’APK signé dans `android/build/distribution/`. Au premier lancement, il crée la clé de signature locale dans `android/.signing/`. Ce dossier reste hors Git. Conserve cette clé et son mot de passe protégé par Windows pour signer les mises à jour avec le même compte Windows. Pour produire une nouvelle version installable, augmente `versionCode` et ajuste `versionName` dans `app/build.gradle`.

Ouvre le dossier `android` dans Android Studio pour lancer la version de développement sur un émulateur ou un téléphone. La version de développement utilise la clé de débogage d’Android Studio.

GitHub Actions compile le projet et vérifie sur un émulateur Android 15 que l’application s’installe, crée un Hub et démarre une manche avec un bot. Chaque exécution joint les captures d’écran.
