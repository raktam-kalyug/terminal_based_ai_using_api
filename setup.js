#!/usr/bin/env node
/**
 * Interactive Setup Wizard for LAN Fox Chat
 * Configures environment, detects IP, selects port, and writes .env
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

// ANSI styling
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(startPort = 3000) {
  let port = Number(startPort);
  while (!(await isPortAvailable(port))) {
    port++;
    if (port > startPort + 50) break;
  }
  return port;
}

function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const results = [];
  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

function createInputHandler() {
  if (!input.isTTY) {
    let lines = [];
    let lineIndex = 0;
    try {
      const content = fs.readFileSync(0, 'utf-8');
      lines = content.split(/\r?\n/);
    } catch {
      lines = [];
    }
    return {
      async ask(query, defaultValue = '') {
        if (lineIndex < lines.length) {
          const val = lines[lineIndex++].trim();
          process.stdout.write(query + val + '\n');
          return val || defaultValue;
        }
        process.stdout.write(query + defaultValue + '\n');
        return defaultValue;
      },
      close() {},
    };
  }

  const rl = readline.createInterface({ input, output });
  return {
    async ask(query, defaultValue = '') {
      const answer = await rl.question(query);
      const trimmed = answer.trim();
      return trimmed || defaultValue;
    },
    close() {
      rl.close();
    },
  };
}

export async function runSetup({ autoStartServer = false } = {}) {
  const io = createInputHandler();

  console.log(`\n${bold(cyan('======================================================'))}`);
  console.log(`  ${bold('🦊 LAN Fox Chat — Interactive Setup Wizard')}`);
  console.log(`${bold(cyan('======================================================'))}\n`);

  // 1. Detect Network IP
  const ips = getNetworkIps();
  console.log(bold('1. Local Network Detection:'));
  if (ips.length > 0) {
    for (const item of ips) {
      console.log(`   ${green('✓')} Found interface ${cyan(item.name)}: ${bold(item.address)}`);
    }
  } else {
    console.log(`   ${yellow('!')} No external IPv4 network interface detected. Server will use localhost.`);
  }
  const primaryIp = ips[0]?.address || '127.0.0.1';
  console.log();

  // 2. Select Port
  console.log(bold('2. Port Selection:'));
  const defaultPort = 3000;
  const recommendedPort = await findAvailablePort(defaultPort);

  if (recommendedPort !== defaultPort) {
    console.log(`   ${yellow('!')} Port ${defaultPort} is currently in use.`);
  }

  const portAnswer = await io.ask(
    `   Enter port to run on [${cyan(recommendedPort)}]: `,
    String(recommendedPort)
  );
  const selectedPort = Number(portAnswer || recommendedPort);
  console.log(`   ${green('✓')} Using port: ${bold(selectedPort)}\n`);

  // 3. Gemini API Key
  console.log(bold('3. Gemini API Key:'));
  console.log(dim('   Get a free API key at: https://aistudio.google.com/apikey'));
  
  let apiKey = '';
  if (fs.existsSync('.env')) {
    const existing = fs.readFileSync('.env', 'utf-8');
    const match = existing.match(/^GEMINI_API_KEY=(.+)$/m);
    if (match && match[1] && !match[1].includes('replace_with_your_key')) {
      apiKey = match[1].trim();
      console.log(`   ${dim('Found existing API key: ' + apiKey.slice(0, 6) + '...' + apiKey.slice(-4))}`);
    }
  }

  while (!apiKey) {
    const keyAnswer = await io.ask(`   Paste your GEMINI_API_KEY: `);
    const trimmed = keyAnswer.trim();
    if (trimmed && trimmed !== 'replace_with_your_key') {
      apiKey = trimmed;
    } else {
      if (!input.isTTY) {
        console.log(`   ${yellow('No interactive terminal detected; using placeholder.')}`);
        apiKey = 'replace_with_your_key';
        break;
      }
      console.log(`   ${yellow('A valid Gemini API key is required to answer chat requests.')}`);
    }
  }
  console.log(`   ${green('✓')} API Key registered.\n`);

  // 4. Model selection
  console.log(bold('4. Model Selection:'));
  const selectedModel = await io.ask(
    `   Primary Gemini model [${cyan('gemini-3.5-flash-lite')}]: `,
    'gemini-3.5-flash-lite'
  );

  const selectedFallback = await io.ask(
    `   Fallback model [${cyan('gemini-3.6-flash')}]: `,
    'gemini-3.6-flash'
  );
  console.log(`   ${green('✓')} Models configured.\n`);

  // 5. Shared Password (optional)
  console.log(bold('5. Access Security (Optional):'));
  const selectedPassword = await io.ask(
    `   Optional shared password for LAN clients [${dim('Press Enter for none')}]: `,
    ''
  );
  if (selectedPassword) {
    console.log(`   ${green('✓')} Shared password set.`);
  } else {
    console.log(`   ${dim('No password required (open on local network).')}`);
  }
  console.log();

  // 6. Write .env
  const envContent = `# LAN Fox Chat Configuration
# Generated by setup wizard on ${new Date().toISOString()}

# Google AI Studio Gemini API Key
GEMINI_API_KEY=${apiKey}

# Gemini models
GEMINI_MODEL=${selectedModel}
GEMINI_FALLBACK_MODEL=${selectedFallback}

# Server port
PORT=${selectedPort}

# Optional shared passphrase for network clients
APP_PASSWORD=${selectedPassword}
`;

  fs.writeFileSync('.env', envContent, { mode: 0o600 });
  console.log(`   ${green('✓')} Configuration saved to ${bold('.env')} with private permissions (0600).\n`);

  // 7. Check node_modules
  if (!fs.existsSync('node_modules')) {
    console.log(bold('6. Installing Dependencies:'));
    console.log(dim('   Running npm install...'));
    try {
      execSync('npm install', { stdio: 'inherit' });
      console.log(`   ${green('✓')} Dependencies installed successfully.\n`);
    } catch (err) {
      console.log(`   ${yellow('Warning:')} npm install encountered an issue: ${err.message}\n`);
    }
  }

  // Summary
  console.log(bold(green('======================================================')));
  console.log(`  ${bold('🎉 Setup Complete!')}`);
  console.log(bold(green('======================================================')));
  console.log(`\n  ${bold('Server Access:')}`);
  console.log(`  • Local Web:        ${cyan(`http://localhost:${selectedPort}`)}`);
  for (const ip of ips) {
    console.log(`  • Network Web:      ${cyan(`http://${ip.address}:${selectedPort}`)}`);
  }
  console.log(`\n  ${bold('Terminal CLI Installation:')}`);
  console.log(`  • On Mac / Linux:`);
  console.log(`    ${yellow(`curl -sSL http://${primaryIp}:${selectedPort}/install | bash`)}`);
  console.log(`  • On Windows (Command Prompt):`);
  console.log(`    ${yellow(`curl -sSL http://${primaryIp}:${selectedPort}/install.bat -o install.bat && install.bat`)}`);
  console.log(`  • Or run directly without installing (any PC with Python):`);
  console.log(`    ${yellow(`curl -sSL http://${primaryIp}:${selectedPort}/fox -o fox.py && python fox.py`)}`);
  console.log(bold(green('======================================================\n')));

  if (autoStartServer) {
    const startAnswer = await io.ask(
      `Would you like to start the server now? [${cyan('Y/n')}]: `,
      'y'
    );
    io.close();

    if (startAnswer.trim().toLowerCase() !== 'n') {
      console.log(`\nStarting server...\n`);
      const serverProcess = spawn('node', ['server.js'], { stdio: 'inherit' });
      serverProcess.on('exit', (code) => {
        process.exit(code ?? 0);
      });
    } else {
      console.log(`\nYou can start the server anytime by running:\n  ${cyan('npm start')}\n`);
    }
  } else {
    io.close();
    console.log(`Starting server now...\n`);
  }

  return { port: selectedPort, apiKey, model: selectedModel, fallbackModel: selectedFallback, password: selectedPassword };
}

// Direct execution from CLI
const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
if (invokedFile === thisFile) {
  runSetup({ autoStartServer: true }).catch((err) => {
    console.error('\nSetup error:', err.message);
    process.exit(1);
  });
}
