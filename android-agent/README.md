# SmartRush Print Agent Android

App Android unica para activar un agente de impresion con QR.

## Compilar

En esta maquina, Android Studio aporta Java en:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
```

El APK debug queda en:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Actualizaciones

La app consulta un manifiesto JSON para detectar versiones nuevas. En produccion debe apuntar al endpoint de Vercel:

```text
https://print.smartrush.io/android/update.json
```

Tambien puedes pasar otra URL en los QR nuevos con:

```powershell
$env:ANDROID_UPDATE_MANIFEST_URL = 'https://tu-dominio/update.json'
```

Formato del manifiesto:

```json
{
  "versionCode": 5,
  "versionName": "0.5.0",
  "apkUrl": "https://tu-dominio/SmartRush-Print-Agent-Android.apk",
  "releaseNotes": "Cambios de la version."
}
```

En Vercel ese manifiesto se genera desde la tabla `public.print_agent_releases` de Supabase. Para publicar una version nueva, inserta una fila con `versionCode` mayor y `apkUrl` publico.

Android siempre pedira confirmacion del usuario para instalar el APK. El APK nuevo debe tener `versionCode` mayor y estar firmado con la misma llave.

## Instalar por USB

Con el movil en depuracion USB:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app/build/outputs/apk/debug/app-debug.apk
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am start -n com.smartrush.printagent/.MainActivity
```

## Flujo actual

1. Escanea el QR generado por `scripts/build-android-activation.js`.
2. La app llama a `activate_print_agent`.
3. Guarda `agent_id` y `agent_token` en preferencias privadas.
4. Queda pausada por defecto.
5. Permite consultar impresoras activas.
6. Permite enviar una prueba ESC/POS por TCP a la primera impresora `receipt` de red con IP.
7. Si se pulsa `Agente pausado - activar`, reclama trabajos con `claim_print_jobs_for_agent`, imprime por TCP 9100 y marca `printed`/`failed`.

El polling funciona mientras la app esta abierta. Para un agente 24/7 en Android hay que convertir este flujo en un foreground service con notificacion permanente.
