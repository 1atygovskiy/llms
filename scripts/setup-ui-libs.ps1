# Download missing vendored UI libraries from upstream ServiceStack/llms
$ErrorActionPreference = "Stop"
$libDir = Join-Path $PSScriptRoot "..\llms\ui\lib"
New-Item -ItemType Directory -Force -Path $libDir | Out-Null

$base = "https://raw.githubusercontent.com/ServiceStack/llms/main/llms/ui"
$files = @(
    "lib/vue.min.mjs",
    "lib/vue-router.min.mjs",
    "lib/servicestack-client.mjs",
    "lib/servicestack-vue.mjs",
    "lib/marked.min.mjs",
    "lib/chart.js",
    "typography.css",
    "fav.svg"
)

foreach ($f in $files) {
    $url = "$base/$f"
    $out = Join-Path (Join-Path $PSScriptRoot "..\llms\ui") ($f -replace "^lib/", "lib\")
    if ($f -notlike "lib/*") {
        $out = Join-Path (Join-Path $PSScriptRoot "..\llms\ui") (Split-Path $f -Leaf)
    }
    Write-Host "Downloading $url -> $out"
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

$browserUi = Join-Path $PSScriptRoot "..\llms\extensions\browser\ui"
New-Item -ItemType Directory -Force -Path $browserUi | Out-Null
$browserBase = "https://raw.githubusercontent.com/ServiceStack/llms/main/llms/extensions/browser/ui"
foreach ($f in @("xterm-esm.js")) {
    $out = Join-Path $browserUi $f
    Write-Host "Downloading $browserBase/$f -> $out"
    Invoke-WebRequest -Uri "$browserBase/$f" -OutFile $out -UseBasicParsing
}

Write-Host "Done. Run: npm run ui:build"
