/**
 * API Server para el scraper de patentes
 * Expone el scraper de Playwright como una API REST
 */

const http = require('http');
const { consultarVehiculo, consultarMultiples, consultarMultas } = require('./playwright-scraper');
const { consultarPropietario } = require('./volanteomaleta-scraper');

const PORT = process.env.PORT || 3000;

/**
 * Parse JSON body from request
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Parse query string
 */
function parseQuery(url) {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return {};
  const query = {};
  const pairs = url.slice(queryStart + 1).split('&');
  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    query[decodeURIComponent(key)] = decodeURIComponent(value || '');
  }
  return query;
}

/**
 * Request handler
 */
async function handleRequest(req, res) {
  const url = req.url;
  const method = req.method;
  const path = url.split('?')[0];

  // CORS preflight
  if (method === 'OPTIONS') {
    sendJSON(res, 200, { ok: true });
    return;
  }

  // Health check
  if (path === '/' || path === '/health') {
    sendJSON(res, 200, {
      status: 'ok',
      service: 'patente-scraper-api',
      timestamp: new Date().toISOString(),
      endpoints: {
        'GET /propietario?patente=XXX': 'Consultar RUT y nombre del propietario',
        'GET /consultar?patente=XXX': 'Consultar info completa de vehículo',
        'GET /multas?patente=XXX': 'Consultar solo multas',
        'POST /propietario': 'Consultar propietario con body { patente }',
        'POST /consultar': 'Consultar con body { patente, tipo }',
        'POST /multas': 'Consultar multas con body { patente }',
        'POST /consultar-multiple': 'Consultar múltiples { patentes: [] }'
      }
    });
    return;
  }

  // Consultar propietario (volanteomaleta)
  if (path === '/propietario') {
    let patente;

    if (method === 'GET') {
      const query = parseQuery(url);
      patente = query.patente;
    } else if (method === 'POST') {
      try {
        const body = await parseBody(req);
        patente = body.patente;
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON body' });
        return;
      }
    } else {
      sendJSON(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!patente) {
      sendJSON(res, 400, { error: 'Patente es requerida' });
      return;
    }

    console.log(`[API] Consultando propietario: ${patente}`);

    try {
      const resultado = await consultarPropietario(patente);
      sendJSON(res, 200, resultado);
    } catch (error) {
      console.error(`[API] Error:`, error.message);
      sendJSON(res, 500, {
        success: false,
        error: error.message,
        patente: patente.toUpperCase()
      });
    }
    return;
  }

  // Consultar multas
  if (path === '/multas') {
    let patente;

    if (method === 'GET') {
      const query = parseQuery(url);
      patente = query.patente;
    } else if (method === 'POST') {
      try {
        const body = await parseBody(req);
        patente = body.patente;
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON body' });
        return;
      }
    } else {
      sendJSON(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!patente) {
      sendJSON(res, 400, { error: 'Patente es requerida' });
      return;
    }

    console.log(`[API] Consultando multas: ${patente}`);

    try {
      const resultado = await consultarMultas(patente);
      sendJSON(res, 200, resultado);
    } catch (error) {
      console.error(`[API] Error:`, error.message);
      sendJSON(res, 500, {
        success: false,
        error: error.message,
        patente: patente.toUpperCase()
      });
    }
    return;
  }

  // Consultar una patente
  if (path === '/consultar') {
    let patente, tipo;

    if (method === 'GET') {
      const query = parseQuery(url);
      patente = query.patente;
      tipo = query.tipo || 'vehiculo';
    } else if (method === 'POST') {
      try {
        const body = await parseBody(req);
        patente = body.patente;
        tipo = body.tipo || 'vehiculo';
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON body' });
        return;
      }
    } else {
      sendJSON(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (!patente) {
      sendJSON(res, 400, { error: 'Patente es requerida' });
      return;
    }

    console.log(`[API] Consultando patente: ${patente}`);

    try {
      const resultado = await consultarVehiculo(patente, tipo);
      sendJSON(res, 200, resultado);
    } catch (error) {
      console.error(`[API] Error:`, error.message);
      sendJSON(res, 500, {
        success: false,
        error: error.message,
        patente: patente.toUpperCase()
      });
    }
    return;
  }

  // Consultar múltiples patentes
  if (path === '/consultar-multiple' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const patentes = body.patentes;
      const tipo = body.tipo || 'vehiculo';

      if (!patentes || !Array.isArray(patentes) || patentes.length === 0) {
        sendJSON(res, 400, { error: 'Se requiere array de patentes' });
        return;
      }

      if (patentes.length > 10) {
        sendJSON(res, 400, { error: 'Máximo 10 patentes por consulta' });
        return;
      }

      console.log(`[API] Consultando ${patentes.length} patentes`);

      const resultados = await consultarMultiples(patentes, tipo);
      sendJSON(res, 200, {
        success: true,
        total: resultados.length,
        resultados
      });
    } catch (error) {
      console.error(`[API] Error:`, error.message);
      sendJSON(res, 500, { error: error.message });
    }
    return;
  }

  // 404
  sendJSON(res, 404, { error: 'Endpoint no encontrado' });
}

// Create server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   Patente Scraper API                              ║
║   Servidor corriendo en http://localhost:${PORT}      ║
╠════════════════════════════════════════════════════╣
║   Endpoints:                                       ║
║   GET  /propietario?patente=XXX  (RUT y nombre)    ║
║   GET  /consultar?patente=XXX    (info completa)   ║
║   GET  /multas?patente=XXX       (solo multas)     ║
║   POST /consultar-multiple { "patentes": [...] }   ║
╚════════════════════════════════════════════════════╝
  `);
});
