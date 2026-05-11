/**
 * 订货系统启动管理器
 * 启动服务器 + 创建公网隧道 + 自动打开浏览器
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PROJECT = path.resolve(__dirname);
const URL_FILE = path.join(PROJECT, 'public_url.txt');
const PID_FILE = path.join(PROJECT, '.tunnel.pid');

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

  // 2. 停止旧服务
  try { execSync('pm2 delete chaonan-yuju', { stdio: 'ignore', shell: true }); } catch (e) {}
  try { fs.unlinkSync(PID_FILE); } catch (e) {}

  // 3. 启动服务
  log('>>> 启动订货系统服务...');
  execSync('pm2 start server.js --name chaonan-yuju', { cwd: PROJECT, stdio: 'inherit', shell: true });

  // 4. 等待就绪
  log('>>> 等待服务启动...');
  const ok = await waitForServer('http://localhost:3000', 10);
  if (!ok) {
    log('❌ 服务启动失败');
    process.exit(1);
  }
  log('✅ 本地服务已启动: http://localhost:3000');
  log('');

  // 5. 创建公网隧道
  log('>>> 正在创建公网隧道...');
  log('>>> (首次连接会提示确认，自动处理)');
  log('');

  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=60',
    '-o', 'UserKnownHostsFile=NUL',
    '-R', '80:localhost:3000',
    'nokey@localhost.run'
  ], { shell: true, cwd: PROJECT, stdio: ['ignore', 'pipe', 'pipe'] });

  let urlFound = false;

  function onTunnelData(text) {
    process.stdout.write(text);
    if (urlFound) return;
    const match = text.match(/https:\/\/[a-zA-Z0-9]+\.lhr\.life/);
    if (match) {
      urlFound = true;
      const url = match[0];
      fs.writeFileSync(URL_FILE, url, 'utf8');
      console.log('');
      console.log('═══════════════════════════════════');
      console.log('  ✅ 系统已上线！');
      console.log('');
      console.log('  公网地址: ' + url);
      console.log('  管理后台: 点右上角 🔐管理');
      console.log('  管理密码: 123456');
      console.log('');
      console.log('  📌 把这个地址发到客户微信群');
      console.log('  客户就能在手机上浏览和下单了');
      console.log('');
      console.log('  ⚠️ 这个窗口不要关！关了系统就停了');
      console.log('═══════════════════════════════════');
      console.log('');
      try { execSync('start ' + url, { shell: true }); } catch (e) {}
    }
  }

  ssh.stdout.on('data', (data) => onTunnelData(data.toString()));
  ssh.stderr.on('data', (data) => onTunnelData(data.toString()));

  ssh.on('error', (err) => {
    log('❌ 隧道创建失败: ' + err.message);
    log('💡 本地仍可用: http://localhost:3000');
  });

  // 保存 PID
  try { fs.writeFileSync(PID_FILE, String(ssh.pid || ''), 'utf8'); } catch (e) {}

  // 处理退出
  process.on('SIGINT', () => {
    log('\n正在关闭...');
    try { execSync('pm2 stop chaonan-yuju', { stdio: 'ignore', shell: true }); } catch (e) {}
    try { ssh.kill(); } catch (e) {}
    process.exit(0);
  });
}

main().catch(err => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
