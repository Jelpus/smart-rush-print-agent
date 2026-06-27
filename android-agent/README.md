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
