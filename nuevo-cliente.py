"""Genera un CRM personalizado a partir de esta plantilla.

Uso:
  python nuevo-cliente.py "Nombre Agencia" "#AZUL" "#DORADO" [--deploy]
                          [--brand-dark "#hex"] [--accent-dark "#hex"]
                          [--pais AR] [--lugares "Dest 1,Dest 2,..."]
                          [--web-url https://web-del-cliente.pages.dev]

Crea ../crm-<slug>/ con nombre, colores, ruta secreta y token nuevos.
Con --deploy: crea D1, aplica schema + migraciones, crea proyecto Pages,
carga el secret CRM_TOKEN y deploya. Imprime URL + token al final.

Variables del proyecto Pages:
  CRM_TOKEN / CRM_ADMIN_TOKEN  secrets, se generan acá.
  RESEND_API_KEY               secret, con --resend (reporte semanal por mail).
  VENTAS_WEB_URL               var, con --web-url: la web del cliente que vende
                               con seña (crm/VENTAS-CONTRATO.md). Arma el link de
                               pasaportes en Ventas; sin ella el panel avisa
                               "Falta configurar la web" y no ofrece el link.
"""
import sys, io, os, re, shutil, secrets, subprocess, argparse, colorsys
sys.stdout.reconfigure(encoding='utf-8')

AQUI = os.path.dirname(os.path.abspath(__file__))
PANEL_BASE = 'panel-4c1f6a.html'
SLUG_BASE = '4c1f6a'

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16)/255 for i in (0, 2, 4))
def rgb2hex(r, g, b):
    return '#%02X%02X%02X' % tuple(round(x*255) for x in (r, g, b))
def ajustar(h, l_obj, s_mult=1.0):
    r, g, b = hex2rgb(h); hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    return rgb2hex(*colorsys.hls_to_rgb(hh, l_obj, min(1, ss*s_mult)))
def luminancia(h):
    r, g, b = hex2rgb(h); return 0.2126*r + 0.7152*g + 0.0722*b
def texto_sobre(h):
    return '#FFFFFF' if luminancia(h) < 0.5 else '#111111'

ap = argparse.ArgumentParser()
ap.add_argument('nombre'); ap.add_argument('brand'); ap.add_argument('accent')
ap.add_argument('--brand-dark'); ap.add_argument('--accent-dark')
ap.add_argument('--pais', default='XX'); ap.add_argument('--lugares')
ap.add_argument('--resend', help='API key de Resend para el reporte semanal por mail')
ap.add_argument('--web-url', help='URL de la web del cliente (VENTAS_WEB_URL, link de pasaportes en Ventas)')
ap.add_argument('--deploy', action='store_true')
a = ap.parse_args()

nombre = a.nombre.strip()
slug_cliente = re.sub(r'[^a-z0-9]+', '-', nombre.lower()).strip('-')
proyecto = f'crm-{slug_cliente}'
destino = os.path.join(os.path.dirname(AQUI), proyecto)
slug_ruta = secrets.token_hex(3)
token = secrets.token_urlsafe(32)          # cliente: CRM completo, Objetivos solo lectura
token_admin = secrets.token_urlsafe(32)    # vos: configurar programa, cerrar semanas, mail

brand = a.brand.upper(); accent = a.accent.upper()
brand_on = texto_sobre(brand)
accent_soft = ajustar(accent, 0.93, 0.9)              # fondo suave claro
brand_dark = (a.brand_dark or ajustar(brand, 0.72)).upper()   # más claro para fondo oscuro
brand_dark_on = texto_sobre(brand_dark)
accent_dark = (a.accent_dark or ajustar(accent, 0.62)).upper()
accent_dark_soft = ajustar(accent, 0.13, 0.6)

if os.path.exists(destino):
    sys.exit(f'Ya existe {destino}')
shutil.copytree(AQUI, destino, ignore=shutil.ignore_patterns(
    'nuevo-cliente.py', 'node_modules', '.wrangler',
    # El setter de WhatsApp es solo de Luna Llena (decisión del 29/10).
    'setter-worker', 'PLAN-setter-*.md', 'SETTER-*.md', 'PRUEBA-REAL.md', 'migracion-039-setter.sql', 'seed-setter-*.sql',
    'setter', 'setter.js', 'setter-*.js'))  # functions/api/setter/ y functions/_lib/setter*.js
os.rename(os.path.join(destino, PANEL_BASE), os.path.join(destino, f'panel-{slug_ruta}.html'))

def patch(path, fn):
    s = open(path, encoding='utf-8').read(); s2 = fn(s)
    open(path, 'w', encoding='utf-8').write(s2)

patch(os.path.join(destino, '_headers'), lambda s: s.replace(SLUG_BASE, slug_ruta))
# el mail semanal linkea al panel: misma ruta secreta
patch(os.path.join(destino, 'functions', 'api', 'objetivos', 'reporte.js'), lambda s: s.replace(SLUG_BASE, slug_ruta))
# el mail usa la paleta del cliente
patch(os.path.join(destino, 'functions', '_lib', 'reporte.js'),
      lambda s: s.replace("ink: '#111111',", f"ink: '{brand}',").replace("glacier: '#404040', glacierSoft: '#F0F0F0',", f"glacier: '{accent}', glacierSoft: '{accent_soft}',"))

def patch_panel(s):
    # tokens claro (bloque :root y :root[data-theme="light"])
    s = s.replace('--brand:#111111;\n  --brand-on:#FFFFFF;\n  --glacier:#404040;\n  --glacier-soft:#F0F0F0;',
                  f'--brand:{brand};\n  --brand-on:{brand_on};\n  --glacier:{accent};\n  --glacier-soft:{accent_soft};')
    s = s.replace('--brand:#111111; --brand-on:#FFFFFF; --glacier:#404040; --glacier-soft:#F0F0F0;',
                  f'--brand:{brand}; --brand-on:{brand_on}; --glacier:{accent}; --glacier-soft:{accent_soft};')
    # tokens oscuro
    s = s.replace('--brand:#FFFFFF;\n    --brand-on:#0A0A0A;\n    --glacier:#CFCFCF;\n    --glacier-soft:#242424;',
                  f'--brand:{brand_dark};\n    --brand-on:{brand_dark_on};\n    --glacier:{accent_dark};\n    --glacier-soft:{accent_dark_soft};')
    s = s.replace('--brand:#FFFFFF; --brand-on:#0A0A0A; --glacier:#CFCFCF; --glacier-soft:#242424;',
                  f'--brand:{brand_dark}; --brand-on:{brand_dark_on}; --glacier:{accent_dark}; --glacier-soft:{accent_dark_soft};')
    # logo: fondo brand, trazo accent
    s = s.replace("rx='7' fill='%23111111'", f"rx='7' fill='%23{brand[1:]}'").replace("stroke='%23FFFFFF'", f"stroke='%23{accent[1:]}'")
    s = s.replace('rx="7" fill="#111111"', f'rx="7" fill="{brand}"').replace('stroke="#FFFFFF" stroke-width="3"', f'stroke="{accent}" stroke-width="3"')
    # nombre
    s = s.replace('<title>CRM</title>', f'<title>{nombre} · CRM</title>')
    s = s.replace('<h2>CRM</h2>', f'<h2>{nombre}</h2>')
    s = s.replace('<span style="display:block"><b>CRM</b></span>', f'<span style="display:block"><b>{nombre}</b></span>')
    # país / destinos
    s = s.replace("const PAIS_ORIGEN = 'XX';", f"const PAIS_ORIGEN = '{a.pais.upper()}';")
    if a.lugares:
        lug = ','.join('"%s"' % x.strip() for x in a.lugares.split(',') if x.strip())
        s = re.sub(r'const LUGARES  = \[.*?\];', f'const LUGARES  = [{lug}];', s)
    return s
patch(os.path.join(destino, f'panel-{slug_ruta}.html'), patch_panel)

wrangler = os.path.join(destino, 'wrangler.toml')
open(wrangler, 'w', encoding='utf-8').write(f'''name = "{proyecto}"
pages_build_output_dir = "."
compatibility_date = "2024-09-23"

[[d1_databases]]
binding = "DB"
database_name = "{proyecto}"
database_id = "PENDIENTE"

# Workers AI: Whisper para transcribir reels del Ideador (/api/transcribir-idea).
[ai]
binding = "AI"
''' + (f'''
# Web del cliente que vende con seña: arma el link de pasaportes en Ventas.
[vars]
VENTAS_WEB_URL = "{a.web_url.rstrip('/')}"
''' if a.web_url else ''))

print(f'Carpeta: {destino}')
print(f'Panel:   /panel-{slug_ruta}')
print(f'Colores: brand {brand} (on {brand_on}) · accent {accent} · soft {accent_soft}')
print(f'         dark  {brand_dark} (on {brand_dark_on}) · {accent_dark} · soft {accent_dark_soft}')

if not a.deploy:
    print(f'Token cliente: {token}')
    print(f'Token admin:   {token_admin}')
    print('Sin --deploy: nada creado en Cloudflare.')
    sys.exit(0)

def run(cmd, **kw):
    print('$', cmd)
    r = subprocess.run(cmd, shell=True, cwd=destino, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:]); sys.exit(f'Falló: {cmd}')
    return r.stdout + r.stderr

out = run(f'npx wrangler d1 create {proyecto}')
m = re.search(r'database_id = "([0-9a-f-]+)"', out)
if not m: print(out); sys.exit('No encontré database_id')
db_id = m.group(1)
patch(wrangler, lambda s: s.replace('PENDIENTE', db_id))

run(f'npx wrangler d1 execute {proyecto} --remote --file=crm/schema.sql -y')
for f in sorted(os.listdir(os.path.join(destino, 'crm'))):
    if f.startswith('migracion-'):
        run(f'npx wrangler d1 execute {proyecto} --remote --file=crm/{f} -y')

run(f'npx wrangler pages project create {proyecto} --production-branch=main')
run(f'npx wrangler pages secret put CRM_TOKEN --project-name={proyecto}', input=token)
run(f'npx wrangler pages secret put CRM_ADMIN_TOKEN --project-name={proyecto}', input=token_admin)
if a.resend:
    run(f'npx wrangler pages secret put RESEND_API_KEY --project-name={proyecto}', input=a.resend)
# el deploy va después del secret, si no las functions no lo ven
run(f'npx wrangler pages deploy . --project-name={proyecto} --branch=main --commit-dirty=true')

print()
print(f'URL:   https://{proyecto}.pages.dev/panel-{slug_ruta}#/leads/pipeline')
print(f'Token cliente: {token}   (CRM completo, Objetivos solo lectura)')
print(f'Token admin:   {token_admin}   (configurar programa, cerrar semanas, mail)')
print(f'D1:    {proyecto} ({db_id})')
if not a.resend:
    print('Sin --resend: el reporte semanal por mail no sale hasta cargar RESEND_API_KEY.')
if not a.web_url:
    print('Sin --web-url: Ventas funciona igual, pero el link de pasaportes queda sin armar hasta cargar VENTAS_WEB_URL.')
print('Objetivos: /panel-' + slug_ruta + '#/objetivos/config  (con el token admin)')
