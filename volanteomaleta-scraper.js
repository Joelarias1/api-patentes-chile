/**
 * Scraper de volanteomaleta.com usando Playwright
 * Obtiene RUT y nombre del propietario del vehículo
 */

const { firefox } = require('playwright');

/**
 * Consultar propietario de un vehículo por patente
 * @param {string} patente - La patente del vehículo (ej: "HVCY94")
 * @returns {Promise<object>} - Información del propietario
 */
async function consultarPropietario(patente) {
  const browser = await firefox.launch({
    headless: true,
    timeout: 45000
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    viewport: { width: 1280, height: 720 },
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    extraHTTPHeaders: {
      'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
    }
  });

  const page = await context.newPage();

  try {
    console.log(`Consultando patente: ${patente}`);

    // Ir a la página con retry
    let pageLoaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Intento ${attempt}: Cargando página...`);
        await page.goto('https://www.volanteomaleta.com/', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        pageLoaded = true;
        break;
      } catch (e) {
        console.log(`Intento ${attempt} falló: ${e.message}`);
        if (attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Esperar el input con retry
    let formFound = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.waitForSelector('input[name="term"]', { timeout: 15000 });
        formFound = true;
        break;
      } catch (e) {
        console.log(`Intento ${attempt}: Formulario no encontrado, reintentando...`);
        if (attempt === 3) throw e;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      }
    }
    console.log('Formulario encontrado');

    // Ingresar la patente
    await page.fill('input[name="term"]', patente.toUpperCase());

    // Pequeña pausa
    await page.waitForTimeout(500);

    // Enviar el formulario (presionar Enter)
    await page.press('input[name="term"]', 'Enter');

    // Esperar a que cargue la tabla de resultados
    console.log('Esperando resultados...');
    await page.waitForSelector('table.table-hover tbody tr', { timeout: 15000 });

    // Extraer datos de la tabla
    const resultado = await page.evaluate(() => {
      const row = document.querySelector('table.table-hover tbody tr');
      if (!row) return null;

      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return null;

      return {
        patente: cells[0]?.textContent?.trim() || null,
        tipo: cells[1]?.textContent?.trim() || null,
        marca: cells[2]?.textContent?.trim() || null,
        modelo: cells[3]?.textContent?.trim() || null,
        rut: cells[4]?.textContent?.trim() || null,
        numeroMotor: cells[5]?.textContent?.trim() || null,
        año: parseInt(cells[6]?.textContent?.trim()) || null,
        nombrePropietario: cells[7]?.textContent?.trim() || null
      };
    });

    if (!resultado) {
      return {
        success: false,
        patente: patente.toUpperCase(),
        error: 'No se encontraron resultados',
        timestamp: new Date().toISOString()
      };
    }

    return {
      success: true,
      patente: resultado.patente,
      propietario: {
        nombre: resultado.nombrePropietario,
        rut: resultado.rut
      },
      vehiculo: {
        tipo: resultado.tipo,
        marca: resultado.marca,
        modelo: resultado.modelo,
        año: resultado.año,
        numeroMotor: resultado.numeroMotor
      },
      timestamp: new Date().toISOString(),
      source: 'volanteomaleta'
    };

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

// Si se ejecuta directamente
if (require.main === module) {
  const patente = process.argv[2] || 'HVCY94';

  console.log(`\nConsultando patente: ${patente}\n`);

  consultarPropietario(patente)
    .then(resultado => {
      console.log('\n=== RESULTADO ===\n');
      console.log(JSON.stringify(resultado, null, 2));
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}

module.exports = { consultarPropietario };
