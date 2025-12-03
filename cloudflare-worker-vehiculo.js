/**
 * Cloudflare Worker dedicado para consultar datos completos del vehículo
 * Endpoint: /consultar?patente=XXX
 * Hace POST a https://www.patentechile.com/resultados
 */

/**
 * Parsear HTML de /resultados para extraer toda la información del vehículo
 */
function parseResultadosHtml(html, patente) {
  const result = {
    success: true,
    patente: patente,
    timestamp: new Date().toISOString(),
    source: 'cloudflare-worker',
    propietario: null,
    vehiculo: null,
    multas: null,
    revisionTecnica: null,
    gases: null,
    permisoCirculacion: null,
    soap: null,
    transportePublico: null,
    restriccionVehicular: null
  };

  try {
    // Verificar si hay error o patente no encontrada
    const errorPatterns = [
      'no se encontr',
      'patente no válida',
      'error al consultar',
      'sin resultados'
    ];

    const htmlLower = html.toLowerCase();
    const hasError = errorPatterns.some(pattern => htmlLower.includes(pattern));

    if (hasError && !htmlLower.includes('multas')) {
      result.success = false;
      result.error = 'Patente no encontrada o error en consulta';
      return result;
    }

    // Función helper para extraer valor de celda después de un label
    const extractValue = (label) => {
      const patterns = [
        new RegExp(`<td[^>]*>\\s*<b>${label}<\\/b>\\s*<\\/td>\\s*<td[^>]*>([^<]+)<\\/td>`, 'i'),
        new RegExp(`<td[^>]*>${label}\\s*<\\/td>\\s*<td[^>]*>([^<]+)<\\/td>`, 'i'),
        new RegExp(`<b>${label}<\\/b>\\s*[:\\s]*([^<]+)(?:<|$)`, 'i'),
        new RegExp(`${label}[:\\s]+([^<\\n]+)`, 'i')
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const value = match[1].trim();
          if (value && value !== '-' && value !== 'N/A') {
            return value;
          }
        }
      }
      return null;
    };

    // Extraer datos del propietario
    const rut = extractValue('RUT');
    const nombre = extractValue('Nombre');

    if (rut || nombre) {
      result.propietario = {
        rut: rut,
        nombre: nombre
      };
    }

    // Extraer datos del vehículo
    const vehiculoData = {
      patente: extractValue('Patente') || patente,
      tipo: extractValue('Tipo'),
      marca: extractValue('Marca'),
      modelo: extractValue('Modelo'),
      año: null,
      color: extractValue('Color'),
      numeroMotor: extractValue('N° de motor') || extractValue('Numero Motor') || extractValue('Motor'),
      numeroChasis: extractValue('N° de chasis') || extractValue('Numero Chasis') || extractValue('Chasis'),
      procedencia: extractValue('Procedencia'),
      fabricante: extractValue('Fabricante'),
      tipoSello: extractValue('Tipo Sello') || extractValue('Sello'),
      combustible: extractValue('Combustible')
    };

    // Extraer año
    const añoMatch = html.match(/Año[:\s]*<\/td>\s*<td[^>]*>(\d{4})/i) ||
                     html.match(/Año[:\s]+(\d{4})/i);
    if (añoMatch) {
      vehiculoData.año = parseInt(añoMatch[1]);
    }

    if (Object.values(vehiculoData).some(v => v !== null && v !== patente)) {
      result.vehiculo = vehiculoData;
    }

    // Extraer multas
    const tieneMultasMatch = html.match(/tiene multas[:\s]*(sí|si|no)/i) ||
                             html.match(/(no tiene multas|sin multas)/i);

    const cantidadMultasMatch = html.match(/cantidad[:\s]*(\d+)/i) ||
                                 html.match(/(\d+)\s*multa/i);

    result.multas = {
      tiene: tieneMultasMatch ? !tieneMultasMatch[0].toLowerCase().includes('no') : false,
      cantidad: cantidadMultasMatch ? parseInt(cantidadMultasMatch[1]) : 0,
      mensaje: extractValue('Multas') || 'Sin información'
    };

    // Extraer revisión técnica
    const rtData = {
      kilometraje: extractValue('Kilometraje'),
      comuna: extractValue('Comuna'),
      mes: extractValue('Mes'),
      ultimoControl: extractValue('Último Control') || extractValue('Ultimo Control'),
      fechaVencimiento: extractValue('Fecha de Vencimiento') || extractValue('Vencimiento')
    };

    if (Object.values(rtData).some(v => v !== null)) {
      result.revisionTecnica = rtData;
    }

    // Extraer permiso de circulación
    const permisoData = {
      añoPago: extractValue('Año Pago') || extractValue('Permiso'),
      municipalidad: extractValue('Municipalidad'),
      fechaPago: extractValue('Fecha de Pago') || extractValue('Fecha Pago')
    };

    if (Object.values(permisoData).some(v => v !== null)) {
      result.permisoCirculacion = permisoData;
    }

    // Extraer SOAP
    const soapData = {
      compania: extractValue('Compañía') || extractValue('Compania') || extractValue('SOAP'),
      fechaInicio: extractValue('Fecha Inicio') || extractValue('Inicio SOAP')
    };

    if (Object.values(soapData).some(v => v !== null)) {
      result.soap = soapData;
    }

    // Extraer transporte público
    const esTransporte = extractValue('Es Transporte Público') || extractValue('Transporte');
    const tipoTransporte = extractValue('Tipo Transporte');

    if (esTransporte || tipoTransporte) {
      result.transportePublico = {
        es: esTransporte,
        tipo: tipoTransporte
      };
    }

    // Extraer restricción vehicular
    const restriccion = extractValue('Restricción') || extractValue('Restriccion Vehicular');
    if (restriccion) {
      result.restriccionVehicular = {
        condicion: restriccion
      };
    }

  } catch (error) {
    result.success = false;
    result.error = `Error al parsear HTML: ${error.message}`;
  }

  return result;
}

export default {
  async fetch(request) {
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
          usage: '/consultar?patente=ABC123'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Probar múltiples endpoints conocidos de PatenteChile
      const endpoints = [
        {
          url: 'https://www.patentechile.com/resultados',
          method: 'POST',
          body: `patente=${patente.toUpperCase()}`,
          contentType: 'application/x-www-form-urlencoded'
        },
        {
          url: `https://www.patentechile.com/resultados?patente=${patente.toUpperCase()}`,
          method: 'GET',
          body: null,
          contentType: null
        },
        {
          url: 'https://patentechile.com/resultado-consulta',
          method: 'POST',
          body: `patente=${patente.toUpperCase()}`,
          contentType: 'application/x-www-form-urlencoded'
        }
      ];

      let response = null;
      let lastError = null;

      for (const endpoint of endpoints) {
        try {
          const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.patentechile.com/',
            'Origin': 'https://www.patentechile.com',
          };

          if (endpoint.contentType) {
            headers['Content-Type'] = endpoint.contentType;
          }

          const fetchOptions = {
            method: endpoint.method,
            headers: headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
          };

          if (endpoint.body) {
            fetchOptions.body = endpoint.body;
          }

          response = await fetch(endpoint.url, fetchOptions);

          if (response.ok) {
            const text = await response.text();
            // Verificar que no sea solo la página de inicio o error
            if (text.includes('Propietario') || text.includes('Vehículo') ||
                text.includes('propietario') || text.includes('vehiculo') ||
                text.includes('RUT') || text.includes('Marca')) {
              // Encontramos datos válidos
              const parsedData = parseResultadosHtml(text, patente.toUpperCase());
              parsedData.endpoint = endpoint.url;
              return new Response(JSON.stringify(parsedData), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
              });
            }
          }
        } catch (err) {
          lastError = err;
          continue;
        }
      }

      // Si ningún endpoint funcionó, devolver error con debug info
      throw new Error(lastError?.message || 'Ningún endpoint devolvió datos válidos');

    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Error al consultar vehículo',
        message: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
