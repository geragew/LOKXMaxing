$ErrorActionPreference = "Stop"
$porta = 8080
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path

$ip = $null

# Descobre a interface que o Windows usa para acessar a rede. A conexao UDP
# nao envia dados; serve somente para obter o endereco IPv4 local correto.
try {
  $socket = [System.Net.Sockets.UdpClient]::new()
  $socket.Connect("8.8.8.8", 65530)
  $ip = $socket.Client.LocalEndPoint.Address.IPAddressToString
  $socket.Dispose()
} catch {
  $ip = $null
}

# Alternativa para computadores sem uma rota externa disponivel.
if (-not $ip) {
  $configuracao = Get-NetIPConfiguration |
    Where-Object {
      $_.NetAdapter.Status -eq "Up" -and
      $_.IPv4Address -and
      $_.IPv4Address.IPAddress -notlike "169.254.*"
    } |
    Sort-Object { if ($_.IPv4DefaultGateway) { 0 } else { 1 } } |
    Select-Object -First 1

  if ($configuracao) {
    $ip = $configuracao.IPv4Address.IPAddress | Select-Object -First 1
  }
}

Write-Host ""
Write-Host "LOKXMaxing iniciado." -ForegroundColor Green
Write-Host "PC:      http://localhost:$porta" -ForegroundColor White

if ($ip) {
  Write-Host "Celular: http://${ip}:$porta" -ForegroundColor Green
  Write-Host "Use o celular na mesma rede Wi-Fi do computador." -ForegroundColor DarkGray
  Write-Host "Se o Windows perguntar, permita o Python em redes privadas." -ForegroundColor DarkGray

  try {
    $interfaceIndex = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $ip |
      Select-Object -First 1 -ExpandProperty InterfaceIndex
    $categoria = Get-NetConnectionProfile -InterfaceIndex $interfaceIndex |
      Select-Object -First 1 -ExpandProperty NetworkCategory

    if ($categoria -eq "Public") {
      Write-Host ""
      Write-Host "ATENCAO: esta rede esta configurada como Publica no Windows." -ForegroundColor Yellow
      Write-Host "Se o celular nao abrir, altere o perfil da rede para Privada" -ForegroundColor Yellow
      Write-Host "ou permita o Python no Firewall para redes privadas." -ForegroundColor Yellow
    }
  } catch {
    # A verificacao do perfil e apenas informativa.
  }
} else {
  Write-Host "Nao foi possivel descobrir o IP local automaticamente." -ForegroundColor Yellow
  Write-Host "Execute ipconfig e use o Endereco IPv4 seguido de :$porta." -ForegroundColor Yellow
}

Write-Host "Pressione Ctrl+C para encerrar." -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://localhost:$porta"
Set-Location -LiteralPath $pasta
python -m http.server $porta --bind 0.0.0.0
