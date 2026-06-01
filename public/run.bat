@echo off
title GaussianHelper Local Server
echo Starting GaussianHelper on http://localhost:8080/ ...
echo Close this window to stop the server.

powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$port = 8080;^
$listener = New-Object System.Net.HttpListener;^
$listener.Prefixes.Add(\"http://localhost:$port/\");^
$listener.Start();^
Start-Process \"http://localhost:$port/\";^
while ($listener.IsListening) {^
    try {^
        $context = $listener.GetContext();^
        $request = $context.Request;^
        $response = $context.Response;^
        $path = $request.Url.LocalPath;^
        if ($path -eq \"/\") { $path = \"/index.html\" }^
        $filePath = Join-Path (Get-Location) $path;^
        if (Test-Path $filePath -PathType Leaf) {^
            $bytes = [System.IO.File]::ReadAllBytes($filePath);^
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower();^
            $contentType = switch ($ext) {^
                \".html\" { \"text/html\" }^
                \".js\"   { \"application/javascript\" }^
                \".css\"  { \"text/css\" }^
                \".json\" { \"application/json\" }^
                \".svg\"  { \"image/svg+xml\" }^
                \".png\"  { \"image/png\" }^
                default { \"application/octet-stream\" }^
            };^
            $response.ContentType = $contentType;^
            $response.ContentLength64 = $bytes.Length;^
            $response.OutputStream.Write($bytes, 0, $bytes.Length);^
        } else {^
            $response.StatusCode = 404;^
        }^
        $response.OutputStream.Close();^
    } catch {^
        # ignore context errors^
    }^
}"
pause
