/**
 * Cloudflare Worker para hacer scraping de patentechile.com
 * Este Worker actúa como proxy desde la infraestructura de Cloudflare,
 * lo que permite eludir las protecciones anti-bot del sitio objetivo.
 */

/**
 * Parsear HTML para extraer información de multas y vehículo
 */
function parseMultasFromHtml(html, patente) {
  const result = {
    patente: patente,
    tieneMultas: false,
    cantidadMultas: 0,
    mensaje: 'No se encontraron multas',
    informacionVehiculo: {},
    multas: [],
    timestamp: new Date().toISOString(),
    source: 'cloudflare-worker'
  };

  try {
    // Buscar indicadores de sin multas
    const indicadoresSinMultas = [
      'no se encontraron multas',
      'sin multas',
      'no tiene multas',
      'no hay multas',
      'sin infracciones',
      'no hay infracciones'
    ];

    const hasNoMultas = indicadoresSinMultas.some(indicator =>
      html.toLowerCase().includes(indicator.toLowerCase())
    );

    if (hasNoMultas) {
      result.mensaje = 'No se encontraron multas';
      return result;
    }

    // Extraer información del vehículo
    const nombreMatch = html.match(/Nombre[:\s]+([A-ZÁÉÍÓÚÑÜ\s]+?)(?:<|Vehiculo|RUT|Año)/i);
    if (nombreMatch) {
      result.informacionVehiculo.nombre = nombreMatch[1].trim();
    }

    const vehiculoMatch = html.match(/Vehiculo[:\s]+([^<]+?)(?=<|Año|Color|$)/i);
    if (vehiculoMatch) {
      result.informacionVehiculo.vehiculo = vehiculoMatch[1].trim();
    }

    const añoMatch = html.match(/Año[:\s]+(\d{4})/i);
    if (añoMatch) {
      result.informacionVehiculo.año = parseInt(añoMatch[1]);
    }

    const colorMatch = html.match(/Color[:\s]+([A-ZÁÉÍÓÚÑÜ]+)/i);
    if (colorMatch) {
      result.informacionVehiculo.color = colorMatch[1].trim();
    }

    // Buscar multas por ROL/CAUSA (patrón más robusto)
    const multasRegex = /ROL\/CAUSA[:\s]+(\d+)|rol[:\s]*["'](\d+)["']|causa[:\s]*["'](\d+)["']/gi;
    const rolesEncontrados = new Set(); // Usar Set para evitar duplicados
    let match;

    while ((match = multasRegex.exec(html)) !== null) {
      const rol = match[1] || match[2] || match[3];
      if (rol) {
        rolesEncontrados.add(rol);
      }
    }

    // Buscar información adicional de cada multa (comuna, año, estado, etc.)
    const multasConDetalles = [];

    // Patrón para buscar bloques de multas con más detalles
    const multaBlockRegex = /<div[^>]*class[^>]*multa[^>]*>[\s\S]*?<\/div>|<tr[^>]*>[\s\S]*?ROL[^<]*(\d{6})[^<]*<[\s\S]*?<\/tr>/gi;
    let blockMatch;

    while ((blockMatch = multaBlockRegex.exec(html)) !== null) {
      const block = blockMatch[0];

      const rolMatch = block.match(/ROL[\/\s]*CAUSA[:\s]*(\d+)|rol[:\s]*["'](\d+)["']/i);
      const comunaMatch = block.match(/comuna[:\s]*([A-ZÁÉÍÓÚÑÜ\s]+?)(?:<|$)/i);
      const estadoMatch = block.match(/estado[:\s]*([A-Za-záéíóúñü\s]+?)(?:<|$)/i);
      const añoMultaMatch = block.match(/año[:\s]*(\d{4})/i);
      const tipoMatch = block.match(/tipo[:\s]*([^<]+?)(?=<|$)/i);

      if (rolMatch) {
        const rol = rolMatch[1] || rolMatch[2];
        multasConDetalles.push({
          rol: rol,
          tipo: tipoMatch ? tipoMatch[1].trim() : 'MULTA POR ROL/CAUSA',
          descripcion: `Multa por ROL/CAUSA ${rol}`,
          estado: estadoMatch ? estadoMatch[1].trim() : 'Pendiente',
          comuna: comunaMatch ? comunaMatch[1].trim() : undefined,
          año: añoMultaMatch ? parseInt(añoMultaMatch[1]) : undefined
        });
      }
    }

    // Si encontramos multas con detalles, usarlas
    if (multasConDetalles.length > 0) {
      result.multas = multasConDetalles;
      result.cantidadMultas = multasConDetalles.length;
      result.tieneMultas = true;
      result.mensaje = `Se encontraron ${multasConDetalles.length} multa(s)`;
    }
    // Si no, usar los roles encontrados sin detalles
    else if (rolesEncontrados.size > 0) {
      result.multas = Array.from(rolesEncontrados).map(rol => ({
        rol: rol,
        tipo: 'MULTA POR ROL/CAUSA',
        descripcion: `Multa por ROL/CAUSA ${rol}`,
        estado: 'Pendiente'
      }));
      result.cantidadMultas = rolesEncontrados.size;
      result.tieneMultas = true;
      result.mensaje = `Se encontraron ${rolesEncontrados.size} multa(s)`;
    }

    // Buscar indicadores explícitos de cantidad de multas
    const cantidadMatch = html.match(/multas encontradas[:\s]*(\d+)/i) ||
                         html.match(/tiene[:\s]*(\d+)[:\s]*multa/i) ||
                         html.match(/infracciones encontradas[:\s]*(\d+)/i);

    if (cantidadMatch) {
      const cantidad = parseInt(cantidadMatch[1]);
      if (cantidad > result.cantidadMultas) {
        result.cantidadMultas = cantidad;
        result.tieneMultas = cantidad > 0;
        result.mensaje = cantidad > 0 ?
          `Se encontraron ${cantidad} multa(s)` :
          'No se encontraron multas';
      }
    }

  } catch (error) {
    result.mensaje = `Error al parsear HTML: ${error.message}`;
    result.error = error.message;
  }

  return result;
}

export default {
  async fetch(request, env, ctx) {
    // Configurar CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Manejar preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      
      // Enrutar según el path
      if (pathname === '/consultar-patente') {
        return await consultarPatente(request, env, ctx);
      } else if (pathname === '/scrape-patente') {
        return await scrapePatente(request, env, ctx);
      }
      
      // Comportamiento por defecto: obtener HTML de URL
      const targetUrl = url.searchParams.get('url');
      
      if (!targetUrl) {
        return new Response(JSON.stringify({
          error: 'Parámetro "url" es requerido',
          usage: '?url=https://www.patentechile.com/consultar-multas/',
          endpoints: {
            'consultar-patente': '/consultar-patente?patente=ABC123',
            'scrape-patente': '/scrape-patente?patente=ABC123'
          }
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Validar que la URL sea del dominio permitido
      const allowedDomains = ['patentechile.com', 'www.patentechile.com'];
      const targetDomain = new URL(targetUrl).hostname;
      
      if (!allowedDomains.some(domain => targetDomain.includes(domain))) {
        return new Response(JSON.stringify({
          error: 'Dominio no permitido',
          allowed: allowedDomains
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Headers que simulan un navegador real desde Cloudflare
      const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'DNT': '1',
        'Connection': 'keep-alive',
        // Headers específicos de Cloudflare que dan más credibilidad
        'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '127.0.0.1',
        'CF-Ray': request.headers.get('CF-Ray') || 'cloudflare-worker',
        'CF-Visitor': '{"scheme":"https"}',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '127.0.0.1',
        'X-Forwarded-Proto': 'https',
        'X-Real-IP': request.headers.get('CF-Connecting-IP') || '127.0.0.1'
      };

      // Realizar la petición al sitio objetivo
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: browserHeaders,
        // Configuraciones adicionales para evitar detección
        redirect: 'follow',
        // Timeout de 30 segundos
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        return new Response(JSON.stringify({
          error: 'Error al acceder al sitio',
          status: response.status,
          statusText: response.statusText
        }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Obtener el contenido HTML
      const html = await response.text();
      
      // Verificar si hay CAPTCHA o bloqueo
      const hasCaptcha = html.toLowerCase().includes('cloudflare') && 
                        (html.toLowerCase().includes('checking your browser') ||
                         html.toLowerCase().includes('please wait') ||
                         html.toLowerCase().includes('ray id'));

      if (hasCaptcha) {
        return new Response(JSON.stringify({
          error: 'CAPTCHA detectado',
          message: 'El sitio está mostrando un CAPTCHA de Cloudflare',
          html: html.substring(0, 1000) // Solo primeros 1000 caracteres para debug
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Retornar el HTML exitosamente
      return new Response(html, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'X-Worker-Status': 'success',
          'X-Target-URL': targetUrl
        }
      });

    } catch (error) {
      console.error('Error en Cloudflare Worker:', error);
      
      return new Response(JSON.stringify({
        error: 'Error interno del Worker',
        message: error.message,
        stack: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Función para hacer scraping específico de patentes
 * Endpoint: /scrape-patente?patente=ABC123
 */
export async function scrapePatente(request, env, ctx) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const patente = url.searchParams.get('patente');
    
    if (!patente) {
      return new Response(JSON.stringify({
        error: 'Parámetro "patente" es requerido',
        usage: '/scrape-patente?patente=ABC123'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // URL del formulario de consulta
    const targetUrl = 'https://www.patentechile.com/consultar-multas/';
    
    // Headers optimizados para el sitio de patentes
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.patentechile.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      'Connection': 'keep-alive'
    };

    // Primero obtener la página del formulario
    const formResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: headers,
      signal: AbortSignal.timeout(30000)
    });

    if (!formResponse.ok) {
      throw new Error(`Error al cargar formulario: ${formResponse.status}`);
    }

    const formHtml = await formResponse.text();
    
    // Verificar si hay CAPTCHA
    if (formHtml.toLowerCase().includes('cloudflare') && 
        formHtml.toLowerCase().includes('checking your browser')) {
      return new Response(JSON.stringify({
        error: 'CAPTCHA detectado en formulario',
        message: 'El sitio está mostrando un CAPTCHA de Cloudflare'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extraer información necesaria del formulario (si es necesario)
    // Por ahora, retornamos el HTML del formulario para que el cliente lo procese
    return new Response(JSON.stringify({
      success: true,
      patente: patente,
      formHtml: formHtml,
      message: 'Formulario obtenido exitosamente desde Cloudflare Worker',
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Error al procesar patente',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Función para simular el envío del formulario y obtener resultados
 * Endpoint: /consultar-patente?patente=ABC123
 */
export async function consultarPatente(request, env, ctx) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(request.url);
    const patente = url.searchParams.get('patente');
    
    if (!patente) {
      return new Response(JSON.stringify({
        error: 'Parámetro "patente" es requerido',
        usage: '/consultar-patente?patente=ABC123'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Basándome en el análisis del JavaScript del sitio, el formulario se envía por POST
    // a https://www.patentechile.com/resultado-multas con los parámetros:
    // frmTerm2: patente, frmOpcion2: tipo (vehiculo/moto)
    const consultaUrl = 'https://www.patentechile.com/resultado-multas';
    
    // Headers que simulan un navegador real desde Cloudflare
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': 'https://www.patentechile.com/consultar-multas/',
      'Origin': 'https://www.patentechile.com',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
      'Connection': 'keep-alive',
      // Headers específicos de Cloudflare que dan más credibilidad
      'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '127.0.0.1',
      'CF-Ray': request.headers.get('CF-Ray') || 'cloudflare-worker',
      'CF-Visitor': '{"scheme":"https"}',
      'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '127.0.0.1',
      'X-Forwarded-Proto': 'https',
      'X-Real-IP': request.headers.get('CF-Connecting-IP') || '127.0.0.1'
    };

    // Datos del formulario (basado en el análisis del JavaScript)
    const formData = new URLSearchParams({
      'frmTerm2': patente,
      'frmOpcion2': 'vehiculo' // Por defecto vehículo, se puede hacer configurable
    });

    // Realizar la consulta POST con los datos del formulario
    const response = await fetch(consultaUrl, {
      method: 'POST',
      headers: headers,
      body: formData,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Error en consulta: ${response.status}`);
    }

    const resultHtml = await response.text();
    
    // Verificar si hay CAPTCHA en la respuesta
    if (resultHtml.toLowerCase().includes('cloudflare') && 
        resultHtml.toLowerCase().includes('checking your browser')) {
      return new Response(JSON.stringify({
        error: 'CAPTCHA detectado en respuesta',
        message: 'El sitio está mostrando un CAPTCHA de Cloudflare'
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Parsear HTML para extraer información estructurada
    const parsedData = parseMultasFromHtml(resultHtml, patente);

    // Retornar el resultado de la consulta como JSON estructurado
    return new Response(JSON.stringify(parsedData), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Error al consultar patente',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
