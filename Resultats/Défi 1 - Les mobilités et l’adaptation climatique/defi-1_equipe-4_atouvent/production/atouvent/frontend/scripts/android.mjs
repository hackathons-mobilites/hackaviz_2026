// Construit l'application Android : site (mode android), copie dans le projet Capacitor, puis APK ou Play Store.
//   node scripts/android.mjs          → APK de test   android/app/build/outputs/apk/debug/app-debug.apk
//   node scripts/android.mjs release  → Play Store    android/app/build/outputs/bundle/release/app-release.aab (+ APK signé)
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const release = process.argv[2] === 'release'
const root = join(import.meta.dirname, '..')
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env })

// L'APK appelle l'API par son adresse complète : on refuse de construire sans adresse HTTPS
const api = (readFileSync(join(root, '.env.android'), 'utf8').match(/^VITE_API_URL=(.+)$/m) || [])[1]?.trim()
if (!api?.startsWith('https://')) throw new Error('.env.android : VITE_API_URL doit être une adresse https://…/api/v1')
console.log(`API utilisée par l'application : ${api}`)

// Capacitor 7 exige Java 21 : si JAVA_HOME est absent ou plus ancien, on prend celui fourni avec Android Studio
const javaVersion = (home) => {
  try {
    // « java -version » écrit sur la sortie d'erreur
    const out = execSync(`"${join(home, 'bin', 'java')}" -version 2>&1`).toString()
    return Number((out.match(/version "(\d+)/) || [])[1] || 0)
  } catch { return 0 }
}
const studioJava = ['C:/Program Files/Android/Android Studio/jbr', '/Applications/Android Studio.app/Contents/jbr/Contents/Home']
  .find((p) => existsSync(p))
if ((!process.env.JAVA_HOME || javaVersion(process.env.JAVA_HOME) < 21) && studioJava) {
  console.log(`Java 21 d'Android Studio utilisé (${studioJava})`)
  process.env.JAVA_HOME = studioJava
}

if (release && !existsSync(join(root, 'android', 'keystore.properties'))) {
  throw new Error('Version Play Store : créer android/keystore.properties (modèle : android/keystore.properties.example)')
}

run('npx vite build --mode android')
run('npx cap sync android')
// Chemin complet : certains Windows ne cherchent pas les programmes dans le dossier courant
const gradle = join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
run(`"${gradle}" ${release ? 'bundleRelease assembleRelease' : 'assembleDebug'}`, join(root, 'android'))
console.log(release
  ? '\nPlay Store : android/app/build/outputs/bundle/release/app-release.aab\nAPK signé : android/app/build/outputs/apk/release/app-release.apk'
  : '\nAPK de test : android/app/build/outputs/apk/debug/app-debug.apk')
