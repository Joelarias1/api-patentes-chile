# API Patentes Chile

API para consultar información de vehículos en Chile por patente.

## Instalación

```bash
npm install
```

## Uso

```bash
npm start
```

El servidor corre en `http://localhost:3000` por defecto. Usa la variable `PORT` para cambiar el puerto.

## Endpoints

### GET /consultar

Consulta información completa del vehículo (propietario, datos del auto, revisión técnica, SOAP, permisos, multas).

```
GET /consultar?patente=JCLJ38
```

### GET /multas

Consulta solo multas del vehículo.

```
GET /multas?patente=JCLJ38
```

### POST /consultar

```
POST /consultar
Content-Type: application/json

{
  "patente": "JCLJ38",
  "tipo": "vehiculo"
}
```

### POST /consultar-multiple

Consulta múltiples patentes (máximo 10).

```
POST /consultar-multiple
Content-Type: application/json

{
  "patentes": ["JCLJ38", "ABC123"]
}
```

## Despliegue

Requiere un servidor con soporte para Playwright (VPS, Railway, Render). No funciona en serverless (Vercel, Cloudflare Workers).
