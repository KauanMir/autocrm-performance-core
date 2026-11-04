# scripts/whatsapp/bootstrap-test-connection.ps1 - launcher do bootstrap
# one-shot (W2A) da conexao WhatsApp do numero de TESTE da Meta na TEST
# COMPANY. Uso: janela NOVA e dedicada do PowerShell, na raiz do repo:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\whatsapp\bootstrap-test-connection.ps1
#
# - Nenhum segredo hardcoded e nenhum parametro: segredos so por
#   Read-Host -AsSecureString (nao vao para o historico do PSReadLine).
# - SecureString -> BSTR -> variavel de ambiente do PROCESSO; o BSTR e
#   liberado com ZeroFreeBSTR. A string .NET intermediaria nao pode ser
#   zerada com garantia (fica no heap ate o GC): por isso a janela e
#   dedicada e deve ser fechada no fim.
# - Sempre roda dry-run primeiro. write so roda se o dry-run passar E houver
#   confirmacao digitada explicitamente.
# - finally: remove todas as WA_BOOTSTRAP_*, sobrescreve o clipboard.
# - ASCII puro de proposito (Windows PowerShell 5.1 le UTF-8 sem BOM como ANSI).
[CmdletBinding()]
param()

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$EnvNames = @(
  'WA_BOOTSTRAP_ACCESS_TOKEN',
  'WA_BOOTSTRAP_SERVICE_ROLE_KEY',
  'WA_BOOTSTRAP_ENCRYPTION_KEY',
  'WA_BOOTSTRAP_WABA_ID',
  'WA_BOOTSTRAP_PHONE_NUMBER_ID',
  'WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER',
  'WA_BOOTSTRAP_CONNECTED_BY',
  'WA_BOOTSTRAP_CONFIRM',
  'WA_BOOTSTRAP_MODE'
)
$WriteConfirmPhrase = 'GRAVAR TEST COMPANY'

function Clear-WaBootstrapEnv {
  foreach ($name in $EnvNames) {
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }
}

function Set-WaSecretEnv {
  param([Parameter(Mandatory = $true)][string]$Name)
  $secure = Read-Host -AsSecureString -Prompt "$Name (SECRET, entrada oculta)"
  $bstr = [IntPtr]::Zero
  try {
    if ($secure.Length -eq 0) { throw "$Name vazio." }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr), 'Process')
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $secure.Dispose()
  }
}

function Set-WaPlainEnv {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Prompt,
    [switch]$Optional
  )
  $value = (Read-Host -Prompt $Prompt).Trim()
  if ($value -eq '') {
    if ($Optional) { return }
    throw "$Name obrigatorio."
  }
  [Environment]::SetEnvironmentVariable($Name, $value, 'Process')
}

function Invoke-WaBootstrap {
  param([Parameter(Mandatory = $true)][ValidateSet('dry-run', 'write')][string]$Mode)
  [Environment]::SetEnvironmentVariable('WA_BOOTSTRAP_MODE', $Mode, 'Process')
  [Environment]::SetEnvironmentVariable('WA_BOOTSTRAP_CONFIRM', 'TEST_COMPANY_ONLY', 'Process')
  & npm.cmd run --silent whatsapp:bootstrap-test-connection | Out-Host
  return $LASTEXITCODE
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'scripts\whatsapp\bootstrap-test-connection.ts'))) {
  throw 'Raiz do repo nao encontrada.'
}

$exitCode = 1
Push-Location $repoRoot
try {
  Clear-WaBootstrapEnv

  Write-Host ''
  Write-Host 'WhatsApp W2A - bootstrap da conexao de TESTE (somente TEST COMPANY).'
  Write-Host 'PROIBIDO usar com numero/token de cliente real.'
  Write-Host ''

  $modeAnswer = (Read-Host -Prompt 'Modo [dry-run | write] (Enter = dry-run)').Trim()
  switch -CaseSensitive ($modeAnswer) {
    '' { $mode = 'dry-run' }
    'dry-run' { $mode = 'dry-run' }
    'write' { $mode = 'write' }
    default { throw 'Modo invalido. Use dry-run ou write.' }
  }

  Set-WaPlainEnv -Name 'WA_BOOTSTRAP_WABA_ID' -Prompt 'WABA ID (non-secret)'
  Set-WaPlainEnv -Name 'WA_BOOTSTRAP_PHONE_NUMBER_ID' -Prompt 'Phone Number ID do numero de TESTE (non-secret)'
  Set-WaPlainEnv -Name 'WA_BOOTSTRAP_DISPLAY_PHONE_NUMBER' -Prompt 'Display phone number (opcional, Enter pula)' -Optional
  Set-WaPlainEnv -Name 'WA_BOOTSTRAP_CONNECTED_BY' -Prompt 'UUID do perfil connected_by (opcional, Enter pula)' -Optional
  Set-WaSecretEnv -Name 'WA_BOOTSTRAP_ACCESS_TOKEN'
  Set-WaSecretEnv -Name 'WA_BOOTSTRAP_SERVICE_ROLE_KEY'
  Set-WaSecretEnv -Name 'WA_BOOTSTRAP_ENCRYPTION_KEY'

  Write-Host ''
  Write-Host '== 1/2 dry-run (nenhuma escrita) =='
  $exitCode = Invoke-WaBootstrap -Mode 'dry-run'

  if ($exitCode -ne 0) {
    Write-Host "dry-run falhou (exit $exitCode). Nada foi gravado; write NAO sera executado."
  } elseif ($mode -eq 'dry-run') {
    Write-Host 'dry-run OK. Nada foi gravado.'
  } else {
    Write-Host ''
    $answer = Read-Host -Prompt "dry-run OK. Para GRAVAR na TEST COMPANY digite exatamente: $WriteConfirmPhrase"
    if ($answer -cne $WriteConfirmPhrase) {
      Write-Host 'Confirmacao nao confere. Nada foi gravado.'
      $exitCode = 3
    } else {
      Write-Host '== 2/2 write (uma unica chamada de whatsapp_connection_upsert) =='
      $exitCode = Invoke-WaBootstrap -Mode 'write'
    }
  }
} finally {
  Clear-WaBootstrapEnv
  Pop-Location
  try { Set-Clipboard -Value ' ' } catch { }
  Write-Host ''
  Write-Host 'Variaveis WA_BOOTSTRAP_* removidas; clipboard sobrescrito.'
  Write-Host 'Feche esta janela. Se o historico do clipboard (Win+V) estiver ligado, apague as entradas com segredo.'
}

exit $exitCode
