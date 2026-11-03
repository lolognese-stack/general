/**
 * Luna Llena | CRM Setting  ->  CRM (crm-plantilla.pages.dev)
 *
 * Pegar este archivo entero en Extensiones > Apps Script del Sheet
 * "Luna Llena | CRM Setting" (reemplaza el contenido de Código.gs).
 *
 * Qué hace:
 *  - Hojas "Registro Setter N" (las llena ManyChat: Marca Temporal, Evento,
 *    ID Suscriptor, Nombre). Cada 5 minutos manda al CRM las filas nuevas.
 *    La columna Nombre es el usuario de Instagram: con eso el CRM une cada
 *    evento con su lead. INBOUND cuenta como "conversación" del día en la
 *    pestaña Conversación; CALENDARIO y CALL crean el lead si no existía.
 *  - Hojas "Closer N" (se cargan a mano). Cada vez que se edita una fila,
 *    esa fila se manda al CRM (fechas de agenda y llamada, setter, closer,
 *    fuente, estrategia, medio, calificado...).
 *
 * Puesta en marcha (una sola vez, desde el menú "CRM Luna Llena" del Sheet):
 *  1. "1. Guardar token del CRM"  -> pegar el token del CRM.
 *  2. "2. Activar sincronización" -> crea los disparadores y pide permisos.
 *  3. "3. Sincronizar todo ahora" -> sube lo que ya hay en el Sheet.
 *
 * El token NO va en el código: queda en las propiedades del script.
 */

var CONFIG = {
  CRM_URL: 'https://crm-plantilla.pages.dev',
  RE_REGISTRO: /^Registro Setter (\d+)$/,
  RE_CLOSER: /^Closer (\d+)$/,
  LOTE: 40,               // filas por pedido (el CRM acepta hasta 50)
  MAX_MS: 4.5 * 60 * 1000 // cortar antes del límite de 6 min de Apps Script
};

// Encabezado de las hojas Closer -> nombre del campo que espera el CRM.
// Lo que no esté acá viaja igual, con el encabezado convertido a_minusculas.
var ALIAS_CLOSER = {
  'nombre': 'nombre',
  'fecha_de_agenda': 'fecha_agenda',
  'fecha_de_llamada': 'fecha_llamada',
  'setter': 'setter',
  'closer': 'closer',
  'agente': 'closer',
  'fuente': 'fuente',
  'estrategia': 'estrategia',
  'medio_de_agenda': 'medio_agenda',
  'calificado': 'calificado'
};

// ---------------------------------------------------------------- menú

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('CRM Luna Llena')
    .addItem('1. Guardar token del CRM', 'guardarToken')
    .addItem('2. Activar sincronización', 'activarSync')
    .addItem('3. Sincronizar todo ahora', 'sincronizarTodo')
    .addSeparator()
    .addItem('Sincronizar Registro (solo filas nuevas)', 'sincronizarRegistro')
    .addItem('Volver a subir los Registro desde cero', 'reiniciarRegistro')
    .addItem('Ver estado', 'verEstado')
    .addItem('Desactivar sincronización', 'desactivarSync')
    .addToUi();
}

function guardarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Token del CRM', 'Pegá el token (el mismo del panel). Queda guardado en las propiedades del script, no en el código.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var t = r.getResponseText().trim();
  if (!t) return ui.alert('Token vacío, no se guardó.');
  PropertiesService.getScriptProperties().setProperty('CRM_TOKEN', t);
  ui.alert('Token guardado.');
}

function activarSync() {
  desactivarSync_();
  ScriptApp.newTrigger('sincronizarRegistro').timeBased().everyMinutes(5).create();
  // Instalable (no el onEdit simple): el simple no puede llamar a servicios externos.
  ScriptApp.newTrigger('alEditar_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  SpreadsheetApp.getUi().alert('Listo: Registro cada 5 minutos y Closer al editar una fila.');
}

function desactivarSync() {
  desactivarSync_();
  SpreadsheetApp.getUi().alert('Sincronización desactivada.');
}

function desactivarSync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'sincronizarRegistro' || f === 'alEditar_') ScriptApp.deleteTrigger(t);
  });
}

function verEstado() {
  var props = PropertiesService.getScriptProperties();
  var lineas = ['Token: ' + (props.getProperty('CRM_TOKEN') ? 'guardado' : 'FALTA'), ''];
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    if (CONFIG.RE_REGISTRO.test(sh.getName())) {
      lineas.push(sh.getName() + ': procesadas ' + (props.getProperty('fila:' + sh.getName()) || 0) + ' de ' + sh.getLastRow() + ' filas');
    }
  });
  lineas.push('', 'Último resultado: ' + (props.getProperty('ultimo') || 'todavía no corrió'));
  var n = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'sincronizarRegistro' || t.getHandlerFunction() === 'alEditar_';
  }).length;
  lineas.push('Disparadores activos: ' + n + ' de 2');
  SpreadsheetApp.getUi().alert(lineas.join('\n'));
}

// ---------------------------------------------------------------- Registro Setter N

/** Manda al CRM las filas nuevas de cada hoja "Registro Setter N". */
function sincronizarRegistro() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return; // ya hay una corrida en curso
  try {
    var inicio = Date.now();
    var props = PropertiesService.getScriptProperties();
    var ss = SpreadsheetApp.getActive();
    var tz = ss.getSpreadsheetTimeZone();
    var resumen = [];

    ss.getSheets().forEach(function (sh) {
      var m = sh.getName().match(CONFIG.RE_REGISTRO);
      if (!m) return;
      var setter = 'Setter ' + m[1];
      var clave = 'fila:' + sh.getName();
      var hecha = Number(props.getProperty(clave)) || 1; // fila 1 = encabezado
      var ultima = sh.getLastRow();

      while (hecha < ultima && Date.now() - inicio < CONFIG.MAX_MS) {
        var n = Math.min(CONFIG.LOTE, ultima - hecha);
        var valores = sh.getRange(hecha + 1, 1, n, 4).getValues();
        var eventos = [];
        valores.forEach(function (r, i) {
          var ev = String(r[1] || '').trim();
          if (!ev) return; // fila vacía
          var cuando = fecha_(r[0], tz);
          if (!cuando) {
            resumen.push(sh.getName() + ' fila ' + (hecha + 1 + i) + ': fecha ilegible (' + r[0] + ')');
            return;
          }
          eventos.push({
            evento: ev,
            fecha: cuando.dia,
            momento: cuando.momento,
            id_suscriptor: String(r[2] || '').trim(),
            nombre: String(r[3] || '').trim()
          });
        });
        if (eventos.length) {
          var res = postCrm_({ tipo: 'registro', setter: setter, eventos: eventos });
          resumen.push(setter + ': ' + res.nuevos + ' nuevos, ' + res.duplicados + ' repetidos, ' +
            res.leads_creados + ' leads creados' + (res.descartados.length ? ', ' + res.descartados.length + ' descartados' : ''));
          res.descartados.forEach(function (d) {
            console.warn(sh.getName() + ' fila ' + (hecha + 1 + d.i) + ' descartada: ' + d.motivo);
          });
        }
        hecha += n;
        props.setProperty(clave, String(hecha)); // solo avanza si el pedido salió bien
      }
    });

    props.setProperty('ultimo', new Date().toISOString() + (resumen.length ? ' | ' + resumen.join(' | ').slice(0, 400) : ' | sin novedades'));
  } catch (err) {
    PropertiesService.getScriptProperties().setProperty('ultimo', new Date().toISOString() + ' | ERROR: ' + err.message);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Vuelve a subir todo el Registro (el CRM no duplica: ignora lo que ya tiene). */
function reiniciarRegistro() {
  var props = PropertiesService.getScriptProperties();
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    if (CONFIG.RE_REGISTRO.test(sh.getName())) props.deleteProperty('fila:' + sh.getName());
  });
  sincronizarRegistro();
}

// ---------------------------------------------------------------- Closer N

/** Disparador instalable: al editar una hoja Closer, manda las filas tocadas. */
function alEditar_(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!CONFIG.RE_CLOSER.test(sh.getName())) return;
  var desde = Math.max(2, e.range.getRow());
  var hasta = Math.min(sh.getLastRow(), e.range.getLastRow());
  if (hasta < desde) return;
  sincronizarCloser_(sh, desde, hasta);
}

function sincronizarCloser_(sh, desde, hasta) {
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var cols = Math.max(sh.getLastColumn(), 1);
  var claves = sh.getRange(1, 1, 1, cols).getValues()[0].map(clave_);
  var total = { leads_actualizados: 0, leads_creados: 0 };

  for (var fila = desde; fila <= hasta; fila += CONFIG.LOTE) {
    var n = Math.min(CONFIG.LOTE, hasta - fila + 1);
    var valores = sh.getRange(fila, 1, n, cols).getValues();
    var filas = [];
    valores.forEach(function (r) {
      var obj = {};
      claves.forEach(function (k, c) {
        if (!k) return;
        obj[ALIAS_CLOSER[k] || k] = celda_(r[c], tz);
      });
      if (String(obj.nombre || '').trim()) filas.push(obj); // sin Nombre no hay a quién unir
    });
    if (!filas.length) continue;
    var res = postCrm_({ tipo: 'agendas', hoja: sh.getName(), filas: filas });
    total.leads_actualizados += res.leads_actualizados;
    total.leads_creados += res.leads_creados;
  }
  PropertiesService.getScriptProperties().setProperty('ultimo',
    new Date().toISOString() + ' | ' + sh.getName() + ' filas ' + desde + '-' + hasta + ': ' +
    total.leads_actualizados + ' leads actualizados, ' + total.leads_creados + ' creados');
}

// ---------------------------------------------------------------- todo junto

function sincronizarTodo() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return SpreadsheetApp.getUi().alert('Ya hay una sincronización corriendo.');
  try {
    SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
      if (CONFIG.RE_CLOSER.test(sh.getName()) && sh.getLastRow() >= 2) sincronizarCloser_(sh, 2, sh.getLastRow());
    });
  } finally {
    lock.releaseLock();
  }
  sincronizarRegistro();
  verEstado();
}

// ---------------------------------------------------------------- utilidades

function postCrm_(payload) {
  var token = PropertiesService.getScriptProperties().getProperty('CRM_TOKEN');
  if (!token) throw new Error('Falta el token: menú CRM Luna Llena > 1. Guardar token del CRM');
  var r = UrlFetchApp.fetch(CONFIG.CRM_URL + '/api/sheet-sync', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-crm-token': token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = r.getResponseCode();
  if (code !== 200) throw new Error('CRM respondió ' + code + ': ' + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

/** "Fecha de Agenda" -> fecha_de_agenda (sin tildes, minúsculas, guion bajo). */
function clave_(h) {
  return String(h || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Valor de celda -> lo que viaja al CRM. Las fechas van como yyyy-MM-dd. */
function celda_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'string') {
    var s = v.trim();
    var dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // 14/07/2026
    if (dmy) return dmy[3] + '-' + ('0' + dmy[2]).slice(-2) + '-' + ('0' + dmy[1]).slice(-2);
    return s;
  }
  return v === null || v === undefined ? '' : v;
}

/** Marca Temporal (fecha real o texto) -> { dia: 'yyyy-MM-dd', momento: ISO con zona }. */
function fecha_(v, tz) {
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return {
    dia: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    momento: Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
  };
}
