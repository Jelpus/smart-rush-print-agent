SmartRush Print Agent para Windows

Este agente debe instalarse en una computadora Windows que este siempre encendida en el local y conectada a la misma red que la impresora.

El agente revisa actualizaciones automaticamente al arrancar. Si hay una nueva version publicada por SmartRush, se actualiza y reinicia solo.

Instalacion:

1. Descomprime el archivo SmartRush-Print-Agent-Windows.zip.
2. Abre la carpeta resultante.
3. Haz doble click en install-windows.cmd.
4. Si Windows pide permisos, acepta.
5. Si Node.js no esta instalado, el instalador intentara instalar Node.js LTS automaticamente usando winget.

Prueba:

1. Haz doble click en test-connection.cmd.
2. Debe mostrar la impresora configurada.
3. Si la impresora es de red, el puerto 9100 deberia aparecer como open cuando la computadora este en la red del local.
4. Si la impresora esta conectada por USB en Windows, debe mostrar type: windows_spooler o type: local_spooler, y windows printer check: found.

Desinstalacion:

Haz doble click en uninstall-windows.cmd.

Soporte:

El agente queda instalado en:
%LOCALAPPDATA%\SmartRush Print Agent
