# Prueba con WhatsApp real sin deploy: levanta el Worker local y un túnel
# público de Cloudflare (sin cuenta) e imprime lo que hay que pegar en Meta.
# Uso, desde plantilla-crm\setter-worker:   powershell -ExecutionPolicy Bypass -File probar-real.ps1
# Para el panel local (Inbox), en otra terminal desde plantilla-crm:
#   npx wrangler pages dev . --port 8791 --binding CRM_TOKEN=dev-cliente CRM_ADMIN_TOKEN=dev-admin SETTER_INTERNAL_SECRET=<el de .dev.vars>
# y abrir http://127.0.0.1:8791/panel-4c1f6a#/inbox

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'Instalando cloudflared (una sola vez)...'
  winget install --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

$vars = @{}
Get-Content .dev.vars | Where-Object { $_ -match '^\s*([A-Z_]+)=(.*)$' } | ForEach-Object { $vars[$Matches[1]] = $Matches[2].Trim() }
foreach ($k in 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'META_PHONE_NUMBER_ID', 'ANTHROPIC_API_KEY') {
  if (-not $vars[$k]) { throw "Falta $k en .dev.vars" }
}

# Avisa si el token de Meta venció (los temporales duran 24 h).
try {
  $dbg = Invoke-RestMethod "https://graph.facebook.com/v24.0/debug_token?input_token=$($vars.META_ACCESS_TOKEN)" -Headers @{ Authorization = "Bearer $($vars.META_ACCESS_TOKEN)" }
  if (-not $dbg.data.is_valid) { throw 'invalido' }
  if ($dbg.data.expires_at -gt 0) { Write-Host ("Token de Meta temporal: vence " + [DateTimeOffset]::FromUnixTimeSeconds($dbg.data.expires_at).LocalDateTime) -ForegroundColor Yellow }
} catch { throw 'El META_ACCESS_TOKEN no es válido o venció: genera uno permanente (PRUEBA-REAL.md, paso 1).' }

Write-Host 'Levantando el Worker local en el puerto 8790...'
$worker = Start-Process -PassThru -NoNewWindow npx -ArgumentList 'wrangler', 'dev', '-c', 'wrangler.local.toml', '--persist-to', '../.wrangler/state', '--port', '8790'
Start-Sleep -Seconds 8

$log = Join-Path $env:TEMP 'setter-tunel.log'
Remove-Item $log -ErrorAction SilentlyContinue
$tunel = Start-Process -PassThru -NoNewWindow cloudflared -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:8790' -RedirectStandardError $log
$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) { $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1; if ($m) { $url = $m.Matches[0].Value } }
}
if (-not $url) { throw "No salió la URL del túnel. Mira $log" }

Write-Host ''
Write-Host 'Pega esto en Meta > tu app > WhatsApp > Configuración > Webhook:' -ForegroundColor Green
Write-Host "  URL de devolución de llamada: $url/webhook"
Write-Host "  Token de verificación:        $($vars.META_VERIFY_TOKEN)"
Write-Host '  Después suscribe el campo "messages".'
Write-Host ''
Write-Host 'Escribe desde tu celular al número de prueba. Ctrl+C para cortar todo.'
try { Wait-Process -Id $tunel.Id } finally {
  Stop-Process -Id $tunel.Id, $worker.Id -Force -ErrorAction SilentlyContinue
  # npx no se lleva a workerd: si queda escuchando en 8790, el próximo arranque se cuelga.
  Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
