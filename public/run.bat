@echo off
title GaussianHelper Local Server
set PORT=8080
set BATCH_PATH=%~f0

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Get-Content $env:BATCH_PATH | Select-Object -Skip 7 | Out-String)"
goto :EOF

$port = $env:PORT
if (-not $port) { $port = 8080 }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Error: Could not start local server on port $port." -ForegroundColor Red
    Write-Host "This usually means another app is already using port $port." -ForegroundColor Yellow
    Write-Host "You can edit this file to change the PORT variable at the top." -ForegroundColor Yellow
    Write-Host "Details: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    Exit 1
}

Write-Host "Starting GaussianHelper local server on http://localhost:$port/ ..." -ForegroundColor Green
Write-Host "Close this window to stop the server." -ForegroundColor Cyan

# Open default browser
try {
    Start-Process "http://localhost:$port/"
} catch {
    Write-Host "Failed to automatically open browser. Please open http://localhost:$port/ manually." -ForegroundColor Yellow
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $path = $request.Url.LocalPath
        if ($path -eq "/") { $path = "/index.html" }
        
        # Ensure we look in the directory of the batch file (or current directory)
        $workingDir = Split-Path $env:BATCH_PATH -Parent
        $filePath = Join-Path $workingDir $path
        
        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = switch ($ext) {
                ".html" { "text/html" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".css"  { "text/css" }
                ".json" { "application/json" }
                ".svg"  { "image/svg+xml" }
                ".png"  { "image/png" }
                ".ico"  { "image/x-icon" }
                default { "application/octet-stream" }
            }
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.OutputStream.Close()
    } catch {
        # ignore context errors (e.g. browser disconnects)
    }
}
