SmartRush Print Agent para macOS

Este agente debe instalarse en una computadora Mac que este siempre encendida en el local y conectada a la misma red que la impresora.

El agente revisa actualizaciones automaticamente al arrancar. Si hay una nueva version publicada por SmartRush, se actualiza y reinicia solo.

Instalacion:

1. Descomprime el archivo SmartRush-Print-Agent-macOS.zip.
2. Abre la carpeta resultante.
3. Haz doble click en install-macos.command.
4. Si macOS muestra una advertencia de seguridad, haz click derecho sobre el archivo y selecciona Abrir.
5. Si macOS dice que no tiene permisos para ejecutar el archivo, abre Terminal en esta carpeta y ejecuta:

   chmod +x *.command

   Luego vuelve a hacer doble click en install-macos.command.

6. Si no encuentra Node.js, el instalador intentara instalar Homebrew y Node.js automaticamente.

Prueba:

1. Haz doble click en test-connection.command.
2. Debe mostrar la impresora configurada.
3. Si la impresora es de red, debe mostrar el puerto 9100 como open.
4. Si la impresora esta conectada por USB en la Mac, debe mostrar type: cups o type: local_spooler, y cups printer check: found.

Si aparece cups printer check: not found:

- Abre Ajustes del Sistema > Impresoras y escaneres.
- Confirma que la impresora esta instalada.
- El nombre de la impresora debe coincidir con printer_name en SmartRush.

Desinstalacion:

Haz doble click en uninstall-macos.command.

Soporte:

Los logs quedan en:
~/Library/Logs/SmartRushPrintAgent/
