# API Patentes Chile

Sistema de consulta de información vehicular en Chile con múltiples fuentes de datos y fallbacks automáticos.

## Arquitectura de Fuentes de Datos

El sistema utiliza un enfoque de **múltiples fuentes con fallback** para garantizar la obtención de datos:

### Prioridades por Tipo de Dato

| Dato | 1° Prioridad | 2° Prioridad | 3° Fallback |
|------|-------------|--------------|-------------|
| **Propietario** | Browser Worker (PatenteChile) | Boostr API | "Desconocido" |
| **Vehículo** | Browser Worker (PatenteChile) | Boostr API | - |
| **SOAP** | Browser Worker (PatenteChile) | Boostr API | - |
| **Revisión Técnica** | Browser Worker (PatenteChile) | Boostr API | - |
| **Multas** | Worker Multas (PatenteChile) | - | - |
| **Permiso Circulación** | Browser Worker (PatenteChile) | - | - |
| **TAG** | Boostr API (requiere RUT) | - | - |
| **Restricción Vehicular** | Browser Worker (PatenteChile) | - | - |
| **Transporte Público** | Browser Worker (PatenteChile) | - | - |

### ¿Por qué PatenteChile es la primera prioridad?

1. **Datos más actualizados**: PatenteChile consulta directamente las fuentes gubernamentales
2. **Información completa del propietario**: Boostr a veces no tiene el nombre/RUT del propietario
3. **Datos adicionales**: Restricción vehicular, transporte público, permiso de circulación

### ¿Cuándo se usa Boostr como fallback?

- Cuando hay **rate limit** en el Browser Worker de Cloudflare
- Cuando hay **timeout** o error de conexión
- Cuando PatenteChile está **bloqueado por CAPTCHA**

---

## Cloudflare Workers (Producción)

### 1. Browser Worker - Datos Completos
**URL**: `https://patente-vehiculo-browser.t4ngible.workers.dev`

Usa Cloudflare Browser Rendering (Puppeteer) para extraer todos los datos de PatenteChile.

```bash
# Consultar vehículo
curl "https://patente-vehiculo-browser.t4ngible.workers.dev/?patente=HVCY94"
```

**Respuesta**:
```json
{
  "success": true,
  "patente": "HVCY94",
  "propietario": {
    "rut": "13295039-3",
    "nombre": "KATHERINE DENISSE PARRA QUINTERO"
  },
  "vehiculo": {
    "marca": "SUZUKI",
    "modelo": "ALTO DLX HB 800CC",
    "año": 2016
  },
  "revisionTecnica": { ... },
  "permisoCirculacion": { ... },
  "soap": { ... },
  "transportePublico": { ... },
  "restriccionVehicular": { ... }
}
```

**Archivos**:
- `cloudflare-worker-vehiculo-browser.js` - Worker con Puppeteer
- `wrangler-browser.toml` - Configuración

**Despliegue**:
```bash
npx wrangler deploy --config wrangler-browser.toml
```

### 2. Worker Multas
**URL**: `https://patente-scraper-worker.t4ngible.workers.dev`

Worker para consultar multas (no requiere navegador).

```bash
curl "https://patente-scraper-worker.t4ngible.workers.dev/consultar-patente?patente=HVCY94"
```

**Archivos**:
- `cloudflare-worker.js` - Worker de multas
- `wrangler.toml` - Configuración

---

## API Local (Desarrollo/Railway)

Para desarrollo local o despliegue en Railway/Render.

### Instalación

```bash
npm install
```

### Uso

```bash
npm start
# O con puerto específico
PORT=3001 npm start
```

El servidor corre en `http://localhost:3000` por defecto.

### Endpoints Locales

#### GET /consultar
Consulta información completa del vehículo.
```bash
curl "http://localhost:3000/consultar?patente=JCLJ38"
```

#### GET /multas
Consulta solo multas del vehículo.
```bash
curl "http://localhost:3000/multas?patente=JCLJ38"
```

#### GET /propietario
Consulta solo datos del propietario.
```bash
curl "http://localhost:3000/propietario?patente=JCLJ38"
```

#### POST /consultar
```bash
curl -X POST http://localhost:3000/consultar \
  -H "Content-Type: application/json" \
  -d '{"patente": "JCLJ38"}'
```

#### POST /consultar-multiple
Consulta múltiples patentes (máximo 10).
```bash
curl -X POST http://localhost:3000/consultar-multiple \
  -H "Content-Type: application/json" \
  -d '{"patentes": ["JCLJ38", "ABC123"]}'
```

---

## Integración con Edge Function

La Edge Function `generar-reporte-vehicular` de Supabase orquesta todas las fuentes:

```
┌─────────────────────────────────────────────────────────────────┐
│                    generar-reporte-vehicular                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Browser Worker (PatenteChile)  ─────────────────────────┐   │
│     └─ Propietario, Vehículo, RT, SOAP, Permisos            │   │
│                                                              │   │
│  2. Si falla o rate limit:                                  │   │
│     └─ Boostr API ──────────────────────────────────────┐   │   │
│        └─ Vehículo, SOAP, RT, Propietario (si tiene)    │   │   │
│                                                          │   │   │
│  3. Worker Multas (siempre) ────────────────────────────│   │   │
│     └─ Multas detalladas                                │   │   │
│                                                          │   │   │
│  4. TAG (si hay RUT) ───────────────────────────────────│   │   │
│     └─ Boostr /tag/{rut}                                │   │   │
│                                                          │   │   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Variables de Entorno

### Cloudflare Workers
- `BROWSER` - Binding para Browser Rendering (automático)
- `TIMEOUT_MS` - Timeout en milisegundos (default: 30000)

### API Local
- `PORT` - Puerto del servidor (default: 3000)

---

## Estructura de Archivos

```
scraper_multas/
├── cloudflare-worker-vehiculo-browser.js  # Worker Browser Rendering
├── cloudflare-worker-vehiculo.js          # Worker fetch (deprecated)
├── cloudflare-worker.js                   # Worker multas
├── wrangler-browser.toml                  # Config Browser Worker
├── wrangler-vehiculo.toml                 # Config fetch Worker
├── wrangler.toml                          # Config multas Worker
├── api-server.js                          # API local (Express)
├── playwright-scraper.js                  # Scraper Playwright
└── package.json
```

---

## Limitaciones

### Browser Rendering (Cloudflare)
- **Rate Limit**: Plan gratuito tiene límites estrictos
- **Costo**: Plan pagado ~$5/mes + por sesión
- **Timeout**: Máximo 30 segundos por request

### Railway/Render
- **IPs bloqueadas**: Algunas IPs de Railway están bloqueadas por PatenteChile
- **Cold start**: Puede tardar en iniciar si está inactivo

### Boostr API
- **Propietario**: No siempre tiene el nombre/RUT del propietario
- **Rate limit**: 5 requests cada 10 segundos
- **Costo**: Plan personalizado con límites diarios
