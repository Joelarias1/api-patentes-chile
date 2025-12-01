/**
 * Scraper de patentechile.com usando Playwright
 * Obtiene información completa del vehículo: propietario, datos del auto,
 * revisión técnica, SOAP, permisos, multas, etc.
 */

const { firefox } = require('playwright');

/**
 * Consultar información completa de un vehículo por patente
 * @param {string} patente - La patente del vehículo (ej: "JCLJ38")
 * @param {string} tipo - Tipo de búsqueda: "vehiculo", "moto", "rut", "vin"
 * @returns {Promise<object>} - Información completa del vehículo
 */
async function consultarVehiculo(patente, tipo = 'vehiculo') {
  const browser = await firefox.launch({
    headless: true,
    timeout: 60000
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'es-CL'
  });

  const page = await context.newPage();

  try {
    console.log(`Consultando patente: ${patente} (tipo: ${tipo})`);

    // Ir a la página principal
    await page.goto('https://www.patentechile.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Esperar a que cargue el formulario
    console.log('Esperando formulario...');
    await page.waitForSelector('#inputTerm', { timeout: 30000 });
    console.log('Formulario encontrado');

    // Seleccionar el tipo de búsqueda si no es vehiculo
    if (tipo !== 'vehiculo') {
      const tabSelector = `.tab-item[data-type="${tipo}"]`;
      await page.click(tabSelector);
      await page.waitForTimeout(500);
    }

    // Ingresar la patente
    console.log('Ingresando patente...');
    await page.fill('#inputTerm', patente.toUpperCase());

    // Esperar un poco para que el JavaScript del sitio esté listo
    await page.waitForTimeout(1000);

    // Hacer clic en el botón de buscar
    console.log('Haciendo clic en buscar...');
    await page.click('#searchBtn');

    // Esperar a que se procese - el sitio muestra un loading y luego redirige
    console.log('Esperando redirección a resultados...');

    // Esperar a que se procese y redirija a resultados
    await page.waitForURL('**/resultados**', { timeout: 60000 });

    // Esperar a que cargue la tabla de resultados
    console.log('Esperando tabla de resultados...');

    // Esperar un poco más para que cargue completamente
    await page.waitForTimeout(3000);

    // Verificar qué hay en la página
    const pageContent = await page.content();
    console.log('URL actual:', page.url());

    // Buscar la tabla con diferentes selectores
    let tableFound = false;
    const selectors = ['.tbl-results', 'table', '.results', '#results', '.tabla-resultados'];
    for (const sel of selectors) {
      const elem = await page.$(sel);
      if (elem) {
        console.log(`Encontrado selector: ${sel}`);
        tableFound = true;
        break;
      }
    }

    if (!tableFound) {
      console.log('No se encontró tabla, analizando contenido...');
      // Buscar si hay contenido con información del vehículo
      const hasVehicleInfo = pageContent.includes('Patente') || pageContent.includes('Propietario');
      console.log('¿Tiene info de vehículo?:', hasVehicleInfo);
    }

    // Verificar si hay resultados
    const noResults = await page.$('.no-results');
    if (noResults) {
      const mensaje = await noResults.textContent();
      return {
        success: false,
        patente: patente.toUpperCase(),
        error: 'No se encontraron resultados',
        mensaje: mensaje?.trim() || 'Patente no encontrada'
      };
    }

    // Extraer toda la información del HTML
    const resultado = await page.evaluate(() => {
      const data = {
        success: true,
        propietario: {},
        vehiculo: {},
        multas: { tiene: false, cantidad: 0, mensaje: '' },
        revisionTecnica: {},
        gases: {},
        permisoCirculacion: {},
        soap: {},
        transportePublico: {},
        restriccionVehicular: {}
      };

      // Función helper para extraer valor de tabla
      const getValue = (label) => {
        const cells = document.querySelectorAll('td');
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].textContent.includes(label)) {
            const nextCell = cells[i + 1];
            if (nextCell) {
              return nextCell.textContent.trim();
            }
          }
        }
        return null;
      };

      // Propietario
      data.propietario.rut = getValue('RUT');
      data.propietario.nombre = getValue('Nombre');

      // Vehículo
      data.vehiculo.patente = getValue('Patente');
      data.vehiculo.tipo = getValue('Tipo');
      data.vehiculo.marca = getValue('Marca');
      data.vehiculo.modelo = getValue('Modelo');
      const año = getValue('Año');
      data.vehiculo.año = año ? parseInt(año) : null;
      data.vehiculo.color = getValue('Color');
      data.vehiculo.numeroMotor = getValue('N° Motor');
      data.vehiculo.numeroChasis = getValue('N° Chasis');
      data.vehiculo.procedencia = getValue('Procedencia');
      data.vehiculo.fabricante = getValue('Fabricante');
      data.vehiculo.tipoSello = getValue('Tipo de sello');
      data.vehiculo.combustible = getValue('Combustible');

      // Multas
      const multasText = document.body.textContent;
      const multasMatch = multasText.match(/posee\s+(\d+)\s+multa/i);
      if (multasMatch) {
        data.multas.tiene = true;
        data.multas.cantidad = parseInt(multasMatch[1]);
        data.multas.mensaje = `Posee ${multasMatch[1]} multa(s)`;
      } else if (multasText.toLowerCase().includes('no posee multas') ||
                 multasText.toLowerCase().includes('sin multas')) {
        data.multas.mensaje = 'No posee multas';
      }

      // Revisión Técnica
      data.revisionTecnica.kilometraje = getValue('Kilometraje');
      data.revisionTecnica.comuna = getValue('Comuna de revisión');
      data.revisionTecnica.mes = getValue('Mes de revisión');
      data.revisionTecnica.ultimoControl = getValue('Último control');
      data.revisionTecnica.fechaVencimiento = getValue('Fecha de vencimiento');

      // Permiso Circulación
      data.permisoCirculacion.añoPago = getValue('Año de pago');
      data.permisoCirculacion.municipalidad = getValue('Municipalidad');
      data.permisoCirculacion.fechaPago = getValue('Fecha de pago');

      // SOAP
      data.soap.compania = getValue('Compañia');
      data.soap.fechaInicio = getValue('Fecha inicio');

      // Transporte Público
      data.transportePublico.es = getValue('Transporte público');
      data.transportePublico.tipo = getValue('Tipo transporte público');

      // Restricción Vehicular
      data.restriccionVehicular.condicion = getValue('Condición');

      // Buscar estados (Vigente/Vencido) en secciones específicas
      const secciones = document.querySelectorAll('tr');
      secciones.forEach(row => {
        const text = row.textContent;
        if (text.includes('Revisión técnica') && text.includes('Estado')) {
          const estado = row.querySelector('td:last-child');
          if (estado) {
            data.revisionTecnica.estado = estado.textContent.replace(/<[^>]*>/g, '').trim();
          }
        }
        if (text.includes('SOAP') && text.includes('Estado')) {
          const estado = row.querySelector('td:last-child');
          if (estado) {
            data.soap.estado = estado.textContent.replace(/<[^>]*>/g, '').trim();
          }
        }
      });

      return data;
    });

    resultado.patente = patente.toUpperCase();
    resultado.timestamp = new Date().toISOString();
    resultado.source = 'playwright-scraper';

    return resultado;

  } catch (error) {
    console.error('Error en scraping:', error.message);
    return {
      success: false,
      patente: patente.toUpperCase(),
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}

/**
 * Consultar múltiples patentes
 * @param {string[]} patentes - Array de patentes
 * @param {string} tipo - Tipo de búsqueda
 * @returns {Promise<object[]>} - Array de resultados
 */
async function consultarMultiples(patentes, tipo = 'vehiculo') {
  const resultados = [];
  for (const patente of patentes) {
    const resultado = await consultarVehiculo(patente, tipo);
    resultados.push(resultado);
    // Pequeña pausa entre consultas
    await new Promise(r => setTimeout(r, 2000));
  }
  return resultados;
}

// Si se ejecuta directamente desde la línea de comandos
if (require.main === module) {
  const patente = process.argv[2] || 'JCLJ38';
  const tipo = process.argv[3] || 'vehiculo';

  console.log(`\nIniciando consulta de patente: ${patente}\n`);

  consultarVehiculo(patente, tipo)
    .then(resultado => {
      console.log('\n=== RESULTADO ===\n');
      console.log(JSON.stringify(resultado, null, 2));
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}

/**
 * Consultar multas usando el Cloudflare Worker
 * @param {string} patente - La patente del vehículo
 * @returns {Promise<object>} - Información de multas
 */
async function consultarMultas(patente) {
  const WORKER_URL = 'https://patente-scraper-worker.t4ngible.workers.dev';

  try {
    console.log(`Consultando multas para patente: ${patente}`);

    const response = await fetch(`${WORKER_URL}/consultar-patente?patente=${patente.toUpperCase()}`);
    const data = await response.json();

    return data;
  } catch (error) {
    console.error('Error consultando multas:', error.message);
    return {
      success: false,
      patente: patente.toUpperCase(),
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = { consultarVehiculo, consultarMultiples, consultarMultas };
