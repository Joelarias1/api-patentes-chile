/**
 * Cloudflare Worker con Browser Rendering para consultar datos del vehículo
 * Usa Puppeteer dentro del Worker para ejecutar JavaScript y extraer datos
 * Endpoint: /?patente=XXX
 */

import puppeteer from '@cloudflare/puppeteer';

/**
 * Extraer datos del vehículo del HTML renderizado
 */
function extractVehicleData(pageContent, patente) {
  const result = {
    success: true,
    patente: patente,
    timestamp: new Date().toISOString(),
    source: 'cloudflare-browser-rendering',
    propietario: null,
    vehiculo: null,
    multas: null,
    revisionTecnica: null,
    permisoCirculacion: null,
    soap: null,
  };

  try {
    // Limpiar HTML entities
    const cleanValue = (val) => {
      if (!val) return null;
      let cleaned = val
        .replace(/&nbsp;/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#\d+;/g, '')
        .trim();
      // Si queda vacío o solo espacios, retornar null
      if (!cleaned || cleaned === '-' || cleaned === 'N/A' || cleaned.length > 100) {
        return null;
      }
      return cleaned;
    };

    // Helper para extraer texto de una celda después de un label
    const extractValue = (label) => {
      const patterns = [
        // Patrón para tablas con <b> label
        new RegExp(`<td[^>]*>\\s*<b>${label}<\\/b>\\s*<\\/td>\\s*<td[^>]*>([^<]+)<\\/td>`, 'i'),
        // Patrón para tablas sin <b>
        new RegExp(`<td[^>]*>${label}\\s*<\\/td>\\s*<td[^>]*>([^<]+)<\\/td>`, 'i'),
        // Patrón para divs/spans
        new RegExp(`>${label}[:\\s]*<\\/[^>]+>\\s*<[^>]+>([^<]+)<`, 'i'),
        // Patrón para id específico
        new RegExp(`id="[^"]*${label.toLowerCase().replace(/\s+/g, '')}[^"]*"[^>]*>([^<]+)<`, 'i'),
        // Patrón general
        new RegExp(`<b>${label}<\\/b>\\s*[:\\s]*([^<]+)(?:<|$)`, 'i'),
        new RegExp(`${label}[:\\s]+([^<\\n]+)`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = pageContent.match(pattern);
        if (match && match[1]) {
          const value = cleanValue(match[1]);
          if (value) {
            return value;
          }
        }
      }
      return null;
    };

    // Propietario
    const rut = extractValue('RUT');
    const nombre = extractValue('Nombre');
    if (rut || nombre) {
      result.propietario = { rut, nombre };
    }

    // Vehículo
    const vehiculoData = {
      patente: patente,
      tipo: extractValue('Tipo'),
      marca: extractValue('Marca'),
      modelo: extractValue('Modelo'),
      año: null,
      color: extractValue('Color'),
      numeroMotor: extractValue('N° de motor') || extractValue('Motor'),
      numeroChasis: extractValue('N° de chasis') || extractValue('Chasis'),
      procedencia: extractValue('Procedencia'),
      fabricante: extractValue('Fabricante'),
      tipoSello: extractValue('Tipo Sello'),
      combustible: extractValue('Combustible'),
    };

    // Extraer año
    const añoMatch = pageContent.match(/Año[:\s]*<\/[^>]+>\s*<[^>]+>(\d{4})/i) ||
                     pageContent.match(/Año[:\s]+(\d{4})/i);
    if (añoMatch) {
      vehiculoData.año = parseInt(añoMatch[1]);
    }

    if (Object.values(vehiculoData).some(v => v !== null && v !== patente)) {
      result.vehiculo = vehiculoData;
    }

    // Multas
    const tieneMultas = pageContent.toLowerCase().includes('tiene multas') &&
                        !pageContent.toLowerCase().includes('no tiene multas');
    const cantidadMatch = pageContent.match(/(\d+)\s*multa/i);

    result.multas = {
      tiene: tieneMultas,
      cantidad: cantidadMatch ? parseInt(cantidadMatch[1]) : 0,
    };

    // Revisión técnica
    result.revisionTecnica = {
      kilometraje: extractValue('Kilometraje'),
      ultimoControl: extractValue('Último Control'),
      fechaVencimiento: extractValue('Vencimiento'),
    };

    // Permiso de circulación
    result.permisoCirculacion = {
      añoPago: extractValue('Año Pago'),
      municipalidad: extractValue('Municipalidad'),
    };

    // SOAP
    result.soap = {
      compania: extractValue('Compañía') || extractValue('SOAP'),
      fechaInicio: extractValue('Fecha Inicio'),
    };

  } catch (error) {
    result.success = false;
    result.error = `Error parsing: ${error.message}`;
  }

  return result;
}

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const patente = url.searchParams.get('patente');

    if (!patente) {
      return new Response(JSON.stringify({
        error: 'Parámetro "patente" es requerido',
        usage: '/?patente=ABC123'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let browser = null;

    try {
      // Conectar al Browser Rendering de Cloudflare
      browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();

      // Configurar timeout y viewport
      page.setDefaultTimeout(30000);
      await page.setViewport({ width: 1280, height: 720 });

      // Navegar a la página principal de PatenteChile
      await page.goto('https://www.patentechile.com/', {
        waitUntil: 'networkidle2',
      });

      // Esperar a que cargue el formulario de búsqueda
      await page.waitForSelector('#inputTerm', { timeout: 15000 });

      // Escribir la patente en el input
      await page.type('#inputTerm', patente.toUpperCase(), { delay: 50 });

      // Hacer clic en el botón de búsqueda y esperar navegación
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        page.click('#searchBtn'),
      ]);

      // Esperar un poco para que se cargue el contenido dinámico
      await new Promise(r => setTimeout(r, 3000));

      // Verificar si hay CAPTCHA de Cloudflare
      const pageContent = await page.content();
      if (pageContent.includes('Just a moment') || pageContent.includes('Checking your browser')) {
        await browser.close();
        browser = null;
        return new Response(JSON.stringify({
          success: false,
          error: 'CAPTCHA detectado',
          message: 'El sitio está mostrando protección de Cloudflare',
        }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Esperar a que aparezca la tabla de resultados
      await page.waitForSelector('#tbl-results', { timeout: 20000 });

      // Esperar a que carguen los datos REALES en la tabla
      await page.waitForFunction(() => {
        const table = document.querySelector('#tbl-results');
        if (!table) return false;
        const text = table.textContent || '';
        // Esperamos que aparezca info real (RUT, marca, etc)
        return (
          text.match(/\d{7,8}-[\dkK]/i) || // RUT format
          text.match(/SUZUKI|TOYOTA|HYUNDAI|CHEVROLET|NISSAN|KIA|MAZDA|HONDA|FORD|PEUGEOT|RENAULT|VOLKSWAGEN|BMW|MERCEDES/i) ||
          text.includes('no se encontr') ||
          text.includes('Patente no válida')
        );
      }, { timeout: 30000 });

      // Espera adicional para que TODAS las secciones terminen de cargar
      await new Promise(r => setTimeout(r, 3000));

      // Extraer datos directamente del DOM usando page.evaluate
      const vehicleData = await page.evaluate((patenteInput) => {
        const result = {
          success: true,
          patente: patenteInput,
          timestamp: new Date().toISOString(),
          source: 'cloudflare-browser-rendering',
          propietario: null,
          vehiculo: null,
          multas: null,
          revisionTecnica: null,
          gases: null,
          permisoCirculacion: null,
          soap: null,
          transportePublico: null,
          restriccionVehicular: null,
        };

        // Buscar la tabla de resultados
        const table = document.querySelector('#tbl-results');
        if (!table) {
          result.success = false;
          result.error = 'No se encontró tabla de resultados';
          return result;
        }

        // Función para extraer valor de una fila por label
        const getValue = (label) => {
          const rows = table.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const labelCell = cells[0].textContent?.trim().replace(/\s+/g, ' ');
              if (labelCell && labelCell.toLowerCase().includes(label.toLowerCase())) {
                const value = cells[1].textContent?.trim();
                if (value && value !== '-' && value !== 'N/A' && !value.includes('&nbsp;')) {
                  return value;
                }
              }
            }
          }
          return null;
        };

        // Propietario
        const rut = getValue('RUT');
        const nombre = getValue('Nombre');
        if (rut || nombre) {
          result.propietario = { rut, nombre };
        }

        // Vehículo
        result.vehiculo = {
          patente: getValue('Patente') || patenteInput,
          tipo: getValue('Tipo'),
          marca: getValue('Marca'),
          modelo: getValue('Modelo'),
          año: parseInt(getValue('Año')) || null,
          color: getValue('Color'),
          numeroMotor: getValue('Motor'),
          numeroChasis: getValue('Chasis'),
          procedencia: getValue('Procedencia'),
          fabricante: getValue('Fabricante'),
          tipoSello: getValue('sello'),
          combustible: getValue('Combustible'),
        };

        // Multas
        const multasText = table.textContent || '';
        const tieneMultas = multasText.includes('posee') && multasText.includes('multa');
        const cantidadMatch = multasText.match(/posee\s*(\d+)\s*multa/i);
        result.multas = {
          tiene: tieneMultas,
          cantidad: cantidadMatch ? parseInt(cantidadMatch[1]) : 0,
        };

        // Revisión técnica
        result.revisionTecnica = {
          kilometraje: getValue('Kilometraje'),
          comuna: getValue('Comuna de revisión'),
          mes: getValue('Mes de revisión'),
          ultimoControl: getValue('Último control'),
          estado: getValue('Estado'),
          fechaVencimiento: getValue('Fecha de vencimiento'),
        };

        // Gases (si hay sección separada)
        // Se comparte con RT en algunos casos

        // Permiso de circulación
        result.permisoCirculacion = {
          añoPago: getValue('Año de pago'),
          municipalidad: getValue('Municipalidad'),
          fechaPago: getValue('Fecha de pago'),
        };

        // SOAP
        result.soap = {
          estado: null,
          compania: getValue('Compañia') || getValue('Compania'),
          fechaInicio: getValue('Fecha inicio'),
          fechaVencimiento: null,
        };
        // Buscar estado y vencimiento de SOAP
        const soapEstado = getValue('Estado');
        if (soapEstado && !soapEstado.includes('VENCIDA')) {
          result.soap.estado = soapEstado;
        }

        // Transporte público
        const esTransporte = getValue('Transporte público');
        const tipoTransporte = getValue('Tipo transporte');
        if (esTransporte) {
          result.transportePublico = {
            es: esTransporte,
            tipo: tipoTransporte,
          };
        }

        // Restricción vehicular
        const condicion = getValue('Condición');
        if (condicion) {
          result.restriccionVehicular = {
            condicion: condicion,
          };
        }

        return result;
      }, patente.toUpperCase());

      // Cerrar el navegador
      await browser.close();
      browser = null;

      return new Response(JSON.stringify(vehicleData), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      // Asegurar que el browser se cierre en caso de error
      if (browser) {
        try { await browser.close(); } catch (e) {}
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'Error al consultar vehículo',
        message: error.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
