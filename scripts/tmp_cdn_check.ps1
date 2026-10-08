$dir = $PSScriptRoot
$out = Join-Path $dir 'tmp_cdn_check.txt'
$tmpDir = Join-Path $dir 'tmp_cdn_probe'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$targets = @(
  @{ k='react19_umd';    u='https://cdn.jsdelivr.net/npm/react@19.3.0/umd/react.production.min.js' },
  @{ k='react18_umd';    u='https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js' },
  @{ k='reactdom18_umd'; u='https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js' },
  @{ k='reactdom19_umd'; u='https://cdn.jsdelivr.net/npm/react-dom@19.3.0/umd/react-dom.production.min.js' },
  @{ k='radix_dialog';   u='https://cdn.jsdelivr.net/npm/@radix-ui/react-dialog@1.2.0/dist/index.d.ts' },
  @{ k='radix_tabs';     u='https://cdn.jsdelivr.net/npm/@radix-ui/react-tabs@1.1.22/dist/index.d.ts' },
  @{ k='rtp_min';        u='https://cdn.jsdelivr.net/npm/react-to-print@3.3.0/dist/react-to-print.min.js' }
)
$lines = @()
foreach ($t in $targets) {
  $dest = Join-Path $tmpDir ($t.k + '.js')
  $sz = -1; $err = ''
  try {
    Invoke-WebRequest -Uri $t.u -OutFile $dest -TimeoutSec 25 -UseBasicParsing -ErrorAction Stop | Out-Null
    $sz = (Get-Item $dest).Length
  } catch {
    $err = $_.Exception.Message
  }
  $head = ''
  if ($sz -gt 0) {
    $txt = [System.IO.File]::ReadAllText($dest)
    $head = $txt.Substring(0, [math]::Min(80, $txt.Length))
    $head = ($head -replace "`r|`n", ' ')
  }
  $lines += ("{0,-14} size={1,-7} err=[{2}] head=[{3}]" -f $t.k, $sz, $err, $head)
}
[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding $false))
Write-Output ("done {0} probes -> {1}" -f $lines.Count, $out)
