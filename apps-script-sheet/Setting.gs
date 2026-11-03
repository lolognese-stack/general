/**
 * Luna Llena | Setting  ->  CRM (crm-plantilla.pages.dev)
 *
 * Sheet nuevo, hecho de cero para el setting sin llamadas. Reemplaza al de
 * "Luna Llena | CRM Setting" (Codigo.gs, con hojas Registro Setter N y
 * Closer N), que queda solo como referencia.
 *
 * Una sola hoja, "Registro". Cada automatización de ManyChat agrega una fila
 * con la acción de Google Sheets "Insertar fila" (Insert Row):
 *
 *   Marca temporal | Evento | ID Suscriptor | Usuario IG | Pieza | Setter
 *
 *   Evento: DIAS · RECORRIDO · PITCH · FORMULARIO · CONSULTA
 *     DIAS        automatización "Cuántos días" (abre la conversación)
 *     RECORRIDO   cada automatización de pieza (en Pieza va su etiqueta)
 *     PITCH       pitch del formulario
 *     FORMULARIO  formulario enviado
 *     CONSULTA    confirmación: formulario completado
 *   ID Suscriptor: {{contact id}} de ManyChat. Es la llave que une todo.
 *   Usuario IG:    {{ig username}} (opcional, sirve si falta el ID).
 *   Pieza:         la etiqueta de la pieza, escrita igual que en el
 *                  Planificador del CRM. Obligatoria en RECORRIDO. En DIAS,
 *                  si la conversación entró por una pieza, ponerla también:
 *                  esa es la pieza de apertura.
 *   Setter:        opcional ("ManyChat" si va vacío).
 *   Marca temporal: la fecha y hora de ManyChat. Si llega vacía, el script
 *                  la completa con la hora en que lee la fila (hasta 5 min
 *                  de diferencia).
 *
 * Cada 5 minutos el script manda al CRM las filas nuevas. Reenviar no
 * duplica: el CRM ignora lo que ya tiene.
 *
 * Puesta en marcha (una sola vez, menú "CRM Luna Llena"):
 *  1. "1. Preparar hoja Registro"  -> crea la hoja con los encabezados.
 *  2. "2. Guardar token del CRM"   -> pegar el token del CRM.
 *  3. "3. Activar sincronización"  -> crea el disparador y pide permisos.
 *  4. "4. Sincronizar ahora"       -> sube lo que ya haya.
 *
 * El token NO va en el código: queda en las propiedades del script.
 */

var CONFIG = {
  CRM_URL: 'https://crm-plantilla.pages.dev',
  HOJA: 'Registro',
  ENCABEZADOS: ['Marca temporal', 'Evento', 'ID Suscriptor', 'Usuario IG', 'Pieza', 'Setter'],
  EVENTOS: ['DIAS', 'RECORRIDO', 'PITCH', 'FORMULARIO', 'CONSULTA'],
  LOTE: 40,                // filas por pedido (el CRM acepta hasta 50)
  MAX_MS: 4.5 * 60 * 1000  // cortar antes del límite de 6 min de Apps Script
};

// ---------------------------------------------------------------- menú

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM Luna Llena')
    .addItem('1. Preparar hoja Registro', 'prepararHoja')
    .addItem('2. Guardar token del CRM', 'guardarToken')
    .addItem('3. Activar sincronización', 'activarSync')
    .addItem('4. Sincronizar ahora', 'sincronizar')
    .addSeparator()
    .addItem('Ver estado', 'verEstado')
    .addItem('Volver a subir todo desde cero', 'reiniciar')
    .addItem('Desactivar sincronización', 'desactivarSync')
    .addToUi();
}

function prepararHoja() {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(CONFIG.HOJA) || ss.insertSheet(CONFIG.HOJA);
  hoja.getRange(1, 1, 1, CONFIG.ENCABEZADOS.length).setValues([CONFIG.ENCABEZADOS]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  // Lista desplegable en Evento, por si alguien carga a mano.
  var regla = SpreadsheetApp.newDataValidation().requireValueInList(CONFIG.EVENTOS, true).setAllowInvalid(false).build();
  hoja.getRange(2, 2, hoja.getMaxRows() - 1, 1).setDataValidation(regla);
  hoja.getRange(2, 3, hoja.getMaxRows() - 1, 1).setNumberFormat('@'); // el ID no se convierte en número
  SpreadsheetApp.getUi().alert('Hoja "' + CONFIG.HOJA + '" lista. Ahora configura ManyChat para que inserte filas acá, en este orden:\n\n' + CONFIG.ENCABEZADOS.join(' | '));
}

function guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Token del CRM', 'Pega el token del CRM (el mismo con el que entras al panel).', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var token = r.getResponseText().trim();
  if (!token) return ui.alert('No se guardó: el token está vacío.');
  PropertiesService.getScriptProperties().setProperty('CRM_TOKEN', token);
  ui.alert('Token guardado.');
}

function activarSync() {
  desactivarSync(true);
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getUi().alert('Sincronización activada: cada 5 minutos se mandan las filas nuevas al CRM.');
}

function desactivarSync(silencioso) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  if (silencioso !== true) SpreadsheetApp.getUi().alert('Sincronización desactivada.');
}

function reiniciar() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('¿Volver a subir todas las filas?', 'El CRM ignora las que ya tiene, así que no duplica.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('ULTIMA_FILA', '1');
  sincronizar();
}

function verEstado() {
  var p = PropertiesService.getScriptProperties();
  var hoja = SpreadsheetApp.getActive().getSheetByName(CONFIG.HOJA);
  var activos = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'sincronizar'; }).length;
  SpreadsheetApp.getUi().alert(
    'Token: ' + (p.getProperty('CRM_TOKEN') ? 'guardado' : 'FALTA') + '\n' +
    'Sincronización automática: ' + (activos ? 'activa' : 'apagada') + '\n' +
    'Filas en Registro: ' + (hoja ? Math.max(0, hoja.getLastRow() - 1) : 'no existe la hoja') + '\n' +
    'Última fila enviada: ' + (p.getProperty('ULTIMA_FILA') || '1') + '\n' +
    'Último envío: ' + (p.getProperty('ULTIMO_ENVIO') || 'nunca') + '\n' +
    'Último resultado: ' + (p.getProperty('ULTIMO_RESULTADO') || '—')
  );
}

// ---------------------------------------------------------------- envío

function sincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // ya hay otra corrida
  try { enviarNuevas_(); } finally { lock.releaseLock(); }
}

function enviarNuevas_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('CRM_TOKEN');
  if (!token) throw new Error('Falta el token del CRM: menú CRM Luna Llena > 2. Guardar token del CRM.');
  var hoja = SpreadsheetApp.getActive().getSheetByName(CONFIG.HOJA);
  if (!hoja) throw new Error('No existe la hoja "' + CONFIG.HOJA + '": menú > 1. Preparar hoja Registro.');

  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var ultima = Number(props.getProperty('ULTIMA_FILA') || '1');
  var fin = hoja.getLastRow();
  if (fin <= ultima) return;

  var col = indices_(hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0]);
  var inicio = Date.now();
  var resumen = { enviadas: 0, nuevas: 0, descartadas: 0 };

  for (var desde = ultima + 1; desde <= fin; desde += CONFIG.LOTE) {
    if (Date.now() - inicio > CONFIG.MAX_MS) break;
    var n = Math.min(CONFIG.LOTE, fin - desde + 1);
    var rango = hoja.getRange(desde, 1, n, hoja.getLastColumn());
    var valores = rango.getValues();
    var eventos = [];
    for (var i = 0; i < valores.length; i++) {
      var f = valores[i];
      if (f.join('') === '') continue;
      var cuando = f[col.marca];
      if (!(cuando instanceof Date)) {
        cuando = cuando ? new Date(cuando) : null;
        if (!cuando || isNaN(cuando.getTime())) {
          // ManyChat no mandó la hora: se usa la de ahora y queda escrita.
          cuando = new Date();
          hoja.getRange(desde + i, col.marca + 1).setValue(cuando);
        }
      }
      eventos.push({
        evento: String(f[col.evento] || '').trim(),
        fecha: Utilities.formatDate(cuando, tz, 'yyyy-MM-dd'),
        momento: Utilities.formatDate(cuando, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        id_suscriptor: String(f[col.id] || '').trim(),
        nombre: col.ig >= 0 ? String(f[col.ig] || '').trim() : '',
        pieza: col.pieza >= 0 ? String(f[col.pieza] || '').trim() : '',
        setter: col.setter >= 0 ? String(f[col.setter] || '').trim() : ''
      });
    }
    if (eventos.length) {
      var r = UrlFetchApp.fetch(CONFIG.CRM_URL + '/api/sheet-sync', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-crm-token': token },
        payload: JSON.stringify({ tipo: 'registro', eventos: eventos })
      });
      if (r.getResponseCode() !== 200) {
        props.setProperty('ULTIMO_RESULTADO', 'Error ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
        throw new Error('El CRM respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
      }
      var j = JSON.parse(r.getContentText());
      resumen.enviadas += eventos.length;
      resumen.nuevas += j.nuevos || 0;
      resumen.descartadas += (j.descartados || []).length;
    }
    props.setProperty('ULTIMA_FILA', String(desde + n - 1));
  }
  props.setProperty('ULTIMO_ENVIO', new Date().toLocaleString());
  props.setProperty('ULTIMO_RESULTADO', resumen.enviadas + ' enviadas, ' + resumen.nuevas + ' nuevas, ' + resumen.descartadas + ' descartadas');
}

// Ubica cada columna por su encabezado, así se pueden reordenar o agregar
// columnas sin romper nada.
function indices_(encabezados) {
  var norm = encabezados.map(function (h) { return String(h).trim().toLowerCase(); });
  var buscar = function (opciones) {
    for (var i = 0; i < opciones.length; i++) { var k = norm.indexOf(opciones[i]); if (k >= 0) return k; }
    return -1;
  };
  var col = {
    marca: buscar(['marca temporal', 'fecha', 'timestamp']),
    evento: buscar(['evento']),
    id: buscar(['id suscriptor', 'id', 'manychat id', 'contact id']),
    ig: buscar(['usuario ig', 'usuario', 'instagram', 'nombre']),
    pieza: buscar(['pieza', 'etiqueta']),
    setter: buscar(['setter'])
  };
  if (col.marca < 0 || col.evento < 0 || col.id < 0) {
    throw new Error('Faltan encabezados en "' + CONFIG.HOJA + '". Tienen que estar: Marca temporal, Evento, ID Suscriptor. Menú > 1. Preparar hoja Registro.');
  }
  return col;
}
