/**
 * 隧道管理器 (ngrok) - 自动重连 + 保存地址
 * 双击 启动系统.bat 就会自动用这个
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT = path.resolve(__dirname);
const URL_FILE = path.join(PROJECT, 'public_url.txt');

let currentUrl = '';
let tunnel = null;
let retryCount = 0;

function saveUrl(url) {
  const cleanUrl = url.replace(/[^a-zA-Z0-9:\/\.\-]/g, '');
  if (cleanUrl && cleanUrl !== currentUrl) {
    currentUrl = cleanUrl;
    fs.writeFileSync(URL_FILE, cleanUrl, 'utf8');
    console.log('\n═══════════════════════════════════');
    console.log('  ✅ 公网地址已更新');
    console.log('  ' + cleanUrl);
    console.log('═══════════════════════════════════\n');
    try { execSync('start ' + cleanUrl, { shell: true }); } catch (e) {}
  }
}

function getNgrokUrl() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const tunnels = JSON.parse(data).tunnels;
          resolve(tunnels.find(t => t.public_url)?.public_url || null);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

function startTunnel() {
  if (tunnel) {
    try { tunnel.kill(); } catch (e) {}
    tunnel = null;
  }

  console.log('>>> 创建公网隧道 (ngrok)...');

  tunnel = spawn('ngrok', ['http', '3000', '--log=stdout'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // 轮询 ngrok API 获取公网地址
  let pollCount = 0;
  const pollTimer = setInterval(async () => {
    const url = await getNgrokUrl();
    if (url) {
      saveUrl(url);
      clearInterval(pollTimer);
    } else if (++pollCount > 30) {
      clearInterval(pollTimer);
      console.log('⚠️  ngrok 启动超时');
    }
  }, 1000);

  tunnel.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  tunnel.on('exit', (code) => {
    clearInterval(pollTimer);
    console.log(`⚠️  隧道断开(code=${code})，5秒后重连...`);
    tunnel = null;
    retryCount++;
    setTimeout(startTunnel, 5000);
  });

  tunnel.on('error', (err) => {
    clearInterval(pollTimer);
    console.log('⚠️  隧道错误: ' + err.message + '，5秒后重连...');
    tunnel = null;
    retryCount++;
    setTimeout(startTunnel, 5000);
  });
}

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:3000', (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const alive = await checkServer();
  if (!alive) {
    console.log('❌ 本地服务没启动，正在启动...');
    const child = spawn('node', ['server.js'], {
      cwd: PROJECT, shell: true, stdio: 'ignore'
    });
    child.unref();
    // 等就绪
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await checkServer()) break;
    }
  }
  console.log('✅ 本地服务正常: http://localhost:3000\n');
  startTunnel();

  process.on('SIGINT', () => {
    console.log('\n正在关闭隧道...');
    try { if (tunnel) tunnel.kill(); } catch (e) {}
    process.exit(0);
  });
}

main();
