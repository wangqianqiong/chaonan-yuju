/**
 * 订货系统启动管理器 (ngrok)
 * 启动服务器 + 创建公网隧道 + 自动打开浏览器
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT = path.resolve(__dirname);
const URL_FILE = path.join(PROJECT, 'public_url.txt');

function log(msg) { console.log(msg); }

async function waitForServer(url, maxSec) {
  for (let i = 0; i < maxSec * 2; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => { res.resume(); resolve(); });
        req.on('error', reject);
        req.setTimeout(1000, () => { req.destroy(); reject('timeout'); });
      });
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

function getNgrokUrl() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const t = JSON.parse(data).tunnels;
          resolve(t.find(x => x.public_url)?.public_url || null);
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════');
  console.log('   辉煌帐篷雨具批发部 · 订货系统');
  console.log('═══════════════════════════════════');
  console.log('');

  // 1. 检查依赖
  if (!fs.existsSync(path.join(PROJECT, 'node_modules'))) {
    log('>>> 正在安装依赖...');
    execSync('npm install', { cwd: PROJECT, stdio: 'inherit' });
  }

  // 2. 启动服务
  log('>>> 启动订货系统服务...');
  const server = spawn('node', ['server.js'], {
    cwd: PROJECT, shell: true, stdio: 'inherit'
  });
  server.on('exit', () => { log('服务已停止'); process.exit(0); });

  // 3. 等待就绪
  log('>>> 等待服务启动...');
  const ok = await waitForServer('http://localhost:3000', 10);
  if (!ok) {
    log('❌ 服务启动失败');
    process.exit(1);
  }
  log('✅ 本地服务已启动: http://localhost:3000\n');

  // 4. 创建 ngrok 隧道
  log('>>> 正在创建公网隧道 (ngrok)...\n');

  const ngrok = spawn('ngrok', ['http', '3000', '--log=stdout'], {
    shell: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  ngrok.stderr.on('data', (d) => process.stderr.write(d.toString()));

  // 5. 等待并获取公网地址
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const url = await getNgrokUrl();
    if (url) {
      fs.writeFileSync(URL_FILE, url, 'utf8');
      console.log('');
      console.log('═══════════════════════════════════');
      console.log('  ✅ 系统已上线！');
      console.log('');
      console.log('  ' + url);
      console.log('');
      console.log('  管理后台: 点右上角 🔐管理');
      console.log('  管理密码: 123456');
      console.log('');
      console.log('  📌 把这个地址发到客户微信群');
      console.log('═══════════════════════════════════\n');
      try { execSync('start ' + url, { shell: true }); } catch (e) {}
      break;
    }
    if (i === 5 || i === 15) log('  隧道建立中...');
  }

  // 6. 保持运行
  process.on('SIGINT', () => {
    log('\n正在关闭...');
    try { ngrok.kill(); } catch (e) {}
    try { server.kill(); } catch (e) {}
    process.exit(0);
  });
}

main().catch(err => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
