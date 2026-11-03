r"""Deploya la demo de la plantilla (crm-plantilla.pages.dev) con una paleta.

Uso:
  python deploy-demo.py "#BRAND" "#ACENTO" [--nombre "Agencia"] [--favicon logo.svg]
                        [--brand-dark "#hex"] [--accent-dark "#hex"] [--seco]

La plantilla queda en gris neutro en el repo (así nuevo-cliente.py puede
reemplazar los tokens por los de cada cliente); esto arma una copia con la
paleta pedida y la sube al proyecto crm-plantilla. Usa la misma cuenta de
colores que nuevo-cliente.py (texto sobre el brand, fondos suaves, variante
para modo oscuro).

Marca actual de la demo: Luna Llena Travel (Perú), naranja #FF7A00 + tinta
#161616. Cada deploy de la demo hay que correrlo con estos mismos valores,
si no el panel vuelve a quedar gris y sin nombre:

  python deploy-demo.py "#FF7A00" "#161616" --nombre "Luna Llena Travel" \
      --favicon ../luna-llena-logos/d3-luna-grande/luna-llena-d3-luna-grande-icono.svg \
      --accent-dark "#FFB066"

--nombre cambia <title>, el encabezado y el pie del menú (mismos reemplazos
que nuevo-cliente.py). --seco arma la copia sin subirla.
"""
import argparse, ast, os, shutil, subprocess, sys, tempfile, urllib.parse
sys.stdout.reconfigure(encoding='utf-8')

AQUI = os.path.dirname(os.path.abspath(__file__))
PANEL = 'panel-4c1f6a.html'

# Las funciones de color salen de nuevo-cliente.py, sin ejecutar el script.
fuente = open(os.path.join(AQUI, 'nuevo-cliente.py'), encoding='utf-8').read()
mod = ast.parse(fuente)
defs = ast.Module(body=[n for n in mod.body if isinstance(n, (ast.FunctionDef, ast.Import, ast.ImportFrom))], type_ignores=[])
helpers = {}
exec(compile(defs, 'nuevo-cliente.py', 'exec'), helpers)
ajustar, texto_sobre = helpers['ajustar'], helpers['texto_sobre']

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('brand')
ap.add_argument('accent')
ap.add_argument('--nombre', help='nombre de la agencia (título, encabezado y pie del menú)')
ap.add_argument('--favicon', help='SVG para el favicon del panel')
ap.add_argument('--brand-dark')
ap.add_argument('--accent-dark')
ap.add_argument('--seco', action='store_true')
a = ap.parse_args()
brand, accent = a.brand.upper(), a.accent.upper()
seco = a.seco
nombre = a.nombre.strip() if a.nombre else None

brand_on = texto_sobre(brand)
accent_soft = ajustar(accent, 0.93, 0.9)
brand_dark = (a.brand_dark or ajustar(brand, 0.72)).upper()
brand_dark_on = texto_sobre(brand_dark)
accent_dark = (a.accent_dark or ajustar(accent, 0.62)).upper()
# Con un acento oscuro propio (casi negro en claro), el fondo suave del modo
# oscuro sale de ese acento y no del claro.
accent_dark_soft = ajustar(accent_dark if a.accent_dark else accent, 0.13, 0.6)


def pintar_panel(s):
    reemplazos = [
        ('--brand:#111111;\n  --brand-on:#FFFFFF;\n  --glacier:#404040;\n  --glacier-soft:#F0F0F0;',
         f'--brand:{brand};\n  --brand-on:{brand_on};\n  --glacier:{accent};\n  --glacier-soft:{accent_soft};'),
        ('--brand:#111111; --brand-on:#FFFFFF; --glacier:#404040; --glacier-soft:#F0F0F0;',
         f'--brand:{brand}; --brand-on:{brand_on}; --glacier:{accent}; --glacier-soft:{accent_soft};'),
        ('--brand:#FFFFFF;\n    --brand-on:#0A0A0A;\n    --glacier:#CFCFCF;\n    --glacier-soft:#242424;',
         f'--brand:{brand_dark};\n    --brand-on:{brand_dark_on};\n    --glacier:{accent_dark};\n    --glacier-soft:{accent_dark_soft};'),
        ('--brand:#FFFFFF; --brand-on:#0A0A0A; --glacier:#CFCFCF; --glacier-soft:#242424;',
         f'--brand:{brand_dark}; --brand-on:{brand_dark_on}; --glacier:{accent_dark}; --glacier-soft:{accent_dark_soft};'),
        ("rx='7' fill='%23111111'", f"rx='7' fill='%23{brand[1:]}'"),
        ("stroke='%23FFFFFF'", f"stroke='%23{accent[1:]}'"),
        ('rx="7" fill="#111111"', f'rx="7" fill="{brand}"'),
        ('stroke="#FFFFFF" stroke-width="3"', f'stroke="{accent}" stroke-width="3"'),
    ]
    if nombre:
        reemplazos += [
            ('<title>CRM</title>', f'<title>{nombre} · CRM</title>'),
            ('<h2>CRM</h2>', f'<h2>{nombre}</h2>'),
            ('<span style="display:block"><b>CRM</b></span>', f'<span style="display:block"><b>{nombre}</b></span>'),
        ]
    for viejo, nuevo in reemplazos:
        if viejo not in s:
            print('aviso: no encontré', viejo[:50].replace('\n', ' '))
        s = s.replace(viejo, nuevo)
    if a.favicon:
        # Reemplaza el ícono entero (el de la plantilla ya fue pintado arriba).
        svg = open(a.favicon, encoding='utf-8').read()
        uri = 'data:image/svg+xml,' + urllib.parse.quote(' '.join(svg.split()), safe="/:=,;'()")
        i = s.index('<link rel="icon" href="data:image/svg+xml,')
        j = s.index('>', i)
        s = s[:i] + f'<link rel="icon" href="{uri}"' + s[j:]
        # Marca del menú: la luna y la montaña del logo de Luna Llena (luna
        # blanca, montaña en el acento) en vez del chevron genérico.
        k = 24 / 188
        pts = [(6, 158), (34, 126), (58, 112), (84, 116), (106, 90), (120, 62), (134, 32), (148, 48), (158, 74), (168, 102), (194, 158)]
        montana = 'M' + 'L'.join(f'{4 + (x - 6) * k:.1f} {8 + (y - 32) * k:.1f}' for x, y in pts)
        chevron = '<path d="M9 10l7 14 7-14" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' % accent
        if chevron in s:
            s = s.replace(chevron, '<circle cx="12.4" cy="12.3" r="7.4" fill="#FFFFFF"/><path d="%s" fill="none" stroke="%s" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' % (montana, accent))
        else:
            print('aviso: no encontré el chevron del menú')
    return s


destino = tempfile.mkdtemp(prefix='crm-plantilla-demo-')
shutil.rmtree(destino)
shutil.copytree(AQUI, destino, ignore=shutil.ignore_patterns(
    '.git', '.wrangler', 'node_modules', 'nuevo-cliente.py', 'deploy-demo.py', '*.md', '.dev.vars',
    # crm/ son migraciones (y puede haber trabajo en curso adentro): no se publican.
    # setter-worker/ es otro deploy (Worker aparte), no va a Pages.
    'crm', 'extension*', 'setter-worker'))
p = os.path.join(destino, PANEL)
panel = pintar_panel(open(p, encoding='utf-8').read())
open(p, 'w', encoding='utf-8').write(panel)
rep = os.path.join(destino, 'functions', '_lib', 'reporte.js')
if os.path.exists(rep):
    s = open(rep, encoding='utf-8').read()
    s = s.replace("ink: '#111111',", f"ink: '{brand}',").replace(
        "glacier: '#404040', glacierSoft: '#F0F0F0',", f"glacier: '{accent}', glacierSoft: '{accent_soft}',")
    open(rep, 'w', encoding='utf-8').write(s)

print(f'Claro:  brand {brand} (texto {brand_on}) · acento {accent} · suave {accent_soft}')
print(f'Oscuro: brand {brand_dark} (texto {brand_dark_on}) · acento {accent_dark} · suave {accent_dark_soft}')
print('Copia en', destino)
if seco:
    sys.exit(0)
r = subprocess.run('npx wrangler pages deploy . --project-name crm-plantilla --branch main --commit-dirty=true',
                   shell=True, cwd=destino, text=True, encoding='utf-8', errors='replace')
shutil.rmtree(destino, ignore_errors=True)
sys.exit(r.returncode)
