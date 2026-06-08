# SmartRush Print Service

Servicio local para reclamar trabajos de impresion desde Supabase e imprimirlos en una impresora de red por TCP `9100`.

El agente puede actualizarse automaticamente desde GitHub al arrancar. Por defecto revisa:

```env
UPDATE_REPO=Jelpus/smart-rush-print-agent
UPDATE_BRANCH=main
```

## Flujo

1. La app web inserta una fila en `print_jobs` con `status = 'to_print'`.
2. Este servicio llama a `claim_print_jobs_for_agent(PRINT_AGENT_TOKEN, AGENT_ID, BATCH_SIZE)`.
3. Supabase marca los jobs como `printing`, asigna `locked_by`, `locked_at`, `locked_until` e incrementa `attempts`.
4. El servicio llama a `get_agent_printers(PRINT_AGENT_TOKEN)` y busca la impresora de su sucursal.
5. Resuelve la IP desde `connection.ip`, `connection.mac` o escaneo de puerto `9100`.
6. Envia el ticket por la red local.
7. Si imprime correctamente, llama a `complete_print_job_for_agent`.
8. Si falla, llama a `fail_print_job_for_agent`; Supabase reprograma el job hasta `max_attempts`.

## Configuracion

1. Asegurate de tener en Supabase las tablas base de `schema.sql`.
2. Ejecuta `supabase/print-agent-rpcs.sql` en Supabase.
3. Crea un agente desde SQL Editor:

```sql
select *
from public.create_print_agent(
  'TENANT_UUID',
  'BRANCH_UUID',
  'Mac local cliente',
  'santiago-surco-main'
);
```

Guarda el `agent_token` devuelto. Supabase solo guardara el hash; el token completo se muestra una vez.

4. Copia `.env.example` a `.env.locale`.
5. Completa:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
PRINT_AGENT_TOKEN=srpa_your-agent-token
AGENT_ID=smartrush-local-printer-01
```

No uses `SUPABASE_SERVICE_ROLE_KEY` en la maquina del cliente. El agente solo necesita anon key + `PRINT_AGENT_TOKEN`.

## branch_printers.connection

Ejemplo recomendado:

```json
{
  "type": "network",
  "ip": "192.168.1.50",
  "port": 9100,
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

Si la IP puede cambiar, deja la MAC. El servicio mirara la cache ARP y, si no la encuentra, hara un barrido de la subred local.

Para una impresora USB instalada en el equipo local, usa:

```json
{
  "type": "local_spooler",
  "printer_name": "EPSON"
}
```

En Windows el agente lo envia al Windows Print Spooler. En macOS lo envia a CUPS con `lp -o raw`.

## Seleccion de impresora

Orden usado por el servicio:

1. Si `print_jobs.printer_id` existe, usa esa impresora activa de `branch_printers`.
2. Si no existe, usa `meta.printer_id` si viene informado.
3. Si no existe una impresora exacta, busca por rol usando `meta.target_role` o `meta.printer_role`.
4. Si no hay metadata de rol, usa `job_type`:
   - `sales_ticket`, `invoice`, `test_ticket` -> `receipt`.
   - `kitchen_ticket`, `food_ticket`, `kds_ticket` -> `kitchen`.
   - `bar_ticket` -> `bar`.
   - `label_ticket` -> `label`.

## Comandos

```bash
npm start
```

Ejecuta el servicio continuamente.

```bash
npm run run-once
```

Procesa una sola ronda de jobs reclamados.

```bash
npm run discover
```

Busca dispositivos locales con el puerto `9100` abierto.

## Formato de payload

Ticket simple:

```json
{
  "title": "SmartRush",
  "orderNumber": "A-102",
  "table": "Mesa 4",
  "lines": [
    "2 x Cafe",
    { "quantity": 1, "name": "Bocadillo", "note": "Sin tomate" }
  ],
  "footer": "Gracias"
}
```

Tambien puedes enviar comandos ESC/POS ya preparados:

```json
{ "rawBase64": "..." }
```

o:

```json
{ "rawHex": "1b400a..." }
```
