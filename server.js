import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import dgram from 'node:dgram';

let apiKey = process.env.GEMINI_API_KEY;

// Auto-run interactive setup if key is missing and run in an interactive terminal
if ((!apiKey || apiKey === 'replace_with_your_key') && process.stdin.isTTY && !process.env.CI) {
  console.log('\n🦊 GEMINI_API_KEY not configured. Launching interactive setup...\n');
  const { runSetup } = await import('./setup.js');
  await runSetup({ autoStartServer: false });
  dotenv.config({ override: true });
  apiKey = process.env.GEMINI_API_KEY;
}

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash';
const password = process.env.APP_PASSWORD || '';

const ai = apiKey && apiKey !== 'replace_with_your_key' ? new GoogleGenAI({ apiKey }) : null;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Helper to determine requesting host and base URL
const getServerUrl = (req) => {
  const host = req.get('host') || `localhost:${port}`;
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}`;
};

// Dynamic CLI download: automatically sets the server URL to this machine
const serveCliScript = (req, res) => {
  const serverUrl = getServerUrl(req);
  const clientPath = path.resolve('public', 'client', 'fox.py');

  try {
    let script = fs.readFileSync(clientPath, 'utf-8');
    script = script.replace(
      /DEFAULT_SERVER_URL = ".*?"/,
      `DEFAULT_SERVER_URL = "${serverUrl}"`
    );
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="fox"');
    res.send(script);
  } catch (err) {
    res.sendFile('client/fox.py', { root: path.resolve('public') });
  }
};

app.get(['/fox', '/cli', '/client/fox.py', '/client/gemini.py'], serveCliScript);

// One-line bash installer for Mac & Linux
app.get(['/install', '/install.sh'], (req, res) => {
  const serverUrl = getServerUrl(req);
  const installScript = `#!/usr/bin/env bash
set -e

SERVER_URL="${serverUrl}"
TARGET_DIR="\${HOME}/.local/bin"

if [ ! -d "\${TARGET_DIR}" ]; then
  mkdir -p "\${TARGET_DIR}"
fi

TARGET="\${TARGET_DIR}/fox"
echo "Fetching terminal client from \${SERVER_URL}..."
curl -sSL "\${SERVER_URL}/fox" -o "\${TARGET}"
chmod +x "\${TARGET}"

# Also create symlink for 'gemini'
ln -sf "\${TARGET}" "\${TARGET_DIR}/gemini" 2>/dev/null || true

echo "✓ Successfully installed 'fox' to \${TARGET}"

if [[ ":\$PATH:" != *":\${TARGET_DIR}:"* ]]; then
  echo ""
  echo "Notice: \${TARGET_DIR} is not currently in your PATH."
  echo "Add it temporarily with:"
  echo '  export PATH="$HOME/.local/bin:$PATH"'
  echo "Or permanently by adding that line to your ~/.zshrc or ~/.bashrc."
  echo ""
fi

echo "Ready. Run:"
echo "  fox                       # Stealth interactive terminal"
echo "  fox \\"your prompt\\"          # Quick answer"
echo "  cat file.txt | fox        # Pipe input directly"
`;
  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.send(installScript);
});

// Windows CMD installer
app.get(['/install.bat', '/install.cmd'], (req, res) => {
  const serverUrl = getServerUrl(req);
  const batScript = `@echo off
setlocal enabledelayedexpansion

echo [Fox] Installing Fox LAN Client from ${serverUrl}...

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
  where py >nul 2>&1
  if %ERRORLEVEL% neq 0 (
    echo [Error] Python 3 was not found in your PATH.
    echo Please install Python from https://python.org or Microsoft Store and try again.
    exit /b 1
  )
  set "PY_CMD=py"
) else (
  set "PY_CMD=python"
)

set "TARGET_DIR=%USERPROFILE%\\.fox"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [Fox] Downloading fox.py...
curl -sSL "${serverUrl}/fox" -o "%TARGET_DIR%\\fox.py"
if %ERRORLEVEL% neq 0 (
  echo [Error] Failed to download fox.py from ${serverUrl}
  exit /b 1
)

(
echo @echo off
echo %PY_CMD% "%TARGET_DIR%\\fox.py" %%*
) > "%TARGET_DIR%\\fox.cmd"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if ($p -notlike '*%TARGET_DIR%*') { [Environment]::SetEnvironmentVariable('Path', $p + ';%TARGET_DIR%', 'User') }" >nul 2>&1

:: Place a launcher in user profile directory so it works in the current session immediately
copy /y "%TARGET_DIR%\\fox.cmd" "%USERPROFILE%\\fox.cmd" >nul 2>&1

endlocal & set "PATH=%USERPROFILE%\\.fox;%PATH%"

echo.
echo ======================================================
echo   [OK] Fox installed successfully!
echo ======================================================
echo.
echo You can now run:
echo   fox                         (Start interactive chat)
echo   fox "What is a laptop?"     (Quick question)
echo   type file.txt ^| fox         (Pipe input on Windows)
echo.
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(batScript);
});

// Windows PowerShell installer
app.get('/install.ps1', (req, res) => {
  const serverUrl = getServerUrl(req);
  const psScript = `# Fox Windows PowerShell Installer
$serverUrl = "${serverUrl}"
Write-Host "[Fox] Installing from $serverUrl..." -ForegroundColor Cyan

$python = (Get-Command python, py -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $python) {
    Write-Host "[Error] Python 3 was not found. Please install Python from https://python.org" -ForegroundColor Red
    return
}

$targetDir = "$env:USERPROFILE\\.fox"
if (!(Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }

Write-Host "[Fox] Downloading fox.py..." -ForegroundColor Cyan
Invoke-WebRequest -Uri "$serverUrl/fox" -OutFile "$targetDir\\fox.py"

"@echo off\`r\`n$($python.Name) \`"$targetDir\\fox.py\`" %*" | Out-File -Encoding ascii "$targetDir\\fox.cmd"

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$targetDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$targetDir", "User")
}
$env:Path = "$targetDir;$env:Path"

Write-Host ""
Write-Host "======================================================" -ForegroundColor Green
Write-Host "  [OK] Fox installed successfully!" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Run:"
Write-Host "  fox                         (Interactive chat)"
Write-Host "  fox 'your prompt'           (Quick question)"
Write-Host "  Get-Content file.txt | fox  (Pipe file in PowerShell)"
Write-Host ""
`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(psScript);
});

app.use(express.static('public'));

app.get('/api/health', (_req, res) => {
  res.json({ running: true, geminiConfigured: Boolean(ai), model, fallbackModel });
});

// Non-streaming chat endpoint
app.post('/api/chat', async (req, res) => {
  if (!ai) {
    return res.status(503).json({ error: 'Gemini is not configured yet. Add GEMINI_API_KEY to .env and restart the server.' });
  }
  if (password && req.get('x-app-password') !== password) {
    return res.status(401).json({ error: 'Enter the shared app password in the page settings.' });
  }
  const { messages, systemInstruction } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'Send between 1 and 40 chat messages.' });
  }

  const contents = [];
  for (const item of messages) {
    if (!item || !['user', 'model'].includes(item.role) || typeof item.text !== 'string' || item.text.length > 12000) {
      return res.status(400).json({ error: 'A message is invalid or too long.' });
    }
    contents.push({ role: item.role, parts: [{ text: item.text }] });
  }

  try {
    let response;
    const models = [...new Set([model, fallbackModel])];
    let lastError;

    for (const candidateModel of models) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const params = { model: candidateModel, contents };
          if (systemInstruction && typeof systemInstruction === 'string') {
            params.config = { systemInstruction };
          }
          response = await ai.models.generateContent(params);
          break;
        } catch (error) {
          lastError = error;
          const status = error?.status || error?.error?.code;
          const errorDetails = JSON.stringify(error);
          const canRetry = status === 429
            || status === 503
            || /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(errorDetails);
          if (!canRetry) throw error;
          if (attempt < 2) await delay(1000 * 2 ** attempt);
        }
      }
      if (response) break;
    }

    if (!response) throw lastError;
    res.json({ text: response.text || 'I could not produce a text response.' });
  } catch (error) {
    console.error('Gemini request failed:', error?.message || error);
    res.status(502).json({ error: 'Gemini could not answer. Check the server connection, API key, model, and quota.' });
  }
});

// Real-time token streaming chat endpoint (Server-Sent Events)
app.post('/api/chat/stream', async (req, res) => {
  if (!ai) {
    return res.status(503).json({ error: 'Gemini is not configured yet. Add GEMINI_API_KEY to .env and restart the server.' });
  }
  if (password && req.get('x-app-password') !== password) {
    return res.status(401).json({ error: 'Enter the shared app password in the page settings.' });
  }
  const { messages, systemInstruction } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'Send between 1 and 40 chat messages.' });
  }

  const contents = [];
  for (const item of messages) {
    if (!item || !['user', 'model'].includes(item.role) || typeof item.text !== 'string' || item.text.length > 12000) {
      return res.status(400).json({ error: 'A message is invalid or too long.' });
    }
    contents.push({ role: item.role, parts: [{ text: item.text }] });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const models = [...new Set([model, fallbackModel])];
  let streamStarted = false;
  let lastError;

  for (const candidateModel of models) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const streamParams = { model: candidateModel, contents };
        if (systemInstruction && typeof systemInstruction === 'string') {
          streamParams.config = { systemInstruction };
        }
        const stream = await ai.models.generateContentStream(streamParams);
        for await (const chunk of stream) {
          streamStarted = true;
          const text = chunk.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (error) {
        lastError = error;
        if (streamStarted) {
          res.write(`data: ${JSON.stringify({ error: error?.message || 'Streaming interrupted.' })}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        const status = error?.status || error?.error?.code;
        const errorDetails = JSON.stringify(error);
        const canRetry = status === 429
          || status === 503
          || /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(errorDetails);
        if (!canRetry) break;
        if (attempt < 2) await delay(1000 * 2 ** attempt);
      }
    }
  }

  res.write(`data: ${JSON.stringify({ error: lastError?.message || 'Gemini could not answer.' })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
});

// Helper to get local network IP addresses
const getLocalIpAddresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
};

// UDP discovery beacon: allows terminal clients to auto-discover server when host IP changes
const startDiscoveryBeacon = (httpPort) => {
  try {
    const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpServer.on('error', () => {
      try { udpServer.close(); } catch {}
    });
    udpServer.on('message', (msg, rinfo) => {
      if (msg.toString().trim() === 'FOX_DISCOVER') {
        const payload = JSON.stringify({
          app: 'fox-lan-chat',
          port: httpPort,
          hostname: os.hostname(),
        });
        udpServer.send(payload, rinfo.port, rinfo.address, () => {});
      }
    });
    udpServer.bind(35353, '0.0.0.0');
  } catch {}
};

app.listen(port, '0.0.0.0', () => {
  startDiscoveryBeacon(port);
  const ips = getLocalIpAddresses();
  const primaryIp = ips[0] || 'YOUR_MAC_IP';
  const mdnsHost = os.hostname().endsWith('.local') ? os.hostname() : `${os.hostname()}.local`;

  console.log(`\n======================================================`);
  console.log(`  🦊 LAN Fox Server running on port ${port}`);
  console.log(`  Local:     http://localhost:${port}`);
  console.log(`  mDNS/LAN:  http://${mdnsHost}:${port} (persistent name)`);
  for (const ip of ips) {
    console.log(`  Network:   http://${ip}:${port}`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`  To install on Mac / Linux terminal:`);
  console.log(`  curl -sSL http://${primaryIp}:${port}/install | bash`);
  console.log(``);
  console.log(`  To install on Windows (Command Prompt):`);
  console.log(`  curl -sSL http://${primaryIp}:${port}/install.bat -o install.bat && install.bat`);
  console.log(``);
  console.log(`  Or run directly without installing (any PC with Python):`);
  console.log(`  curl -sSL http://${primaryIp}:${port}/fox -o fox.py && python fox.py`);
  console.log(`======================================================\n`);
});
