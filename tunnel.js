/**
 * 隧道管理器 - 自动重连 + 保存地址
 * 双击 启动系统.bat 就会自动用这个
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname);
const URL_FILE = path.join(PROJECT, 'public_url.txt');

let currentUrl = '';
let ssh = null;
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

function startTunnel() {
  if (ssh) {
    try { ssh.kill(); } catch (e) {}
    ssh = null;
  }

  console.log('>>> 创建公网隧道...');

  ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', '80:localhost:3000',
    'nokey@localhost.run'
  ], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

  ssh.stdout.on('data', (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9]+\.lhr\.life/);
    if (match) saveUrl(match[0]);
  });

  ssh.stderr.on('data', (data) => {
    const text = data.toString();
    process.stderr.write(text);
    const match = text.match(/https:\/\/[a-zA-Z0-9]+\.lhr\.life/);
    if (match) saveUrl(match[0]);
  });

  ssh.on('exit', (code) => {
    console.log(`⚠️  隧道断开(code=${code})，5秒后重连...`);
    ssh = null;
    retryCount++;
    setTimeout(startTunnel, 5000);
  });

  ssh.on('error', (err) => {
    console.log('⚠️  隧道错误: ' + err.message + '，5秒后重连...');
    ssh = null;
    retryCount++;
    setTimeout(startTunnel, 5000);
  });
}

// 先看本地服务是否在线
const http = require('http');
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
    execSync('pm2 start server.js --name chaonan-yuju', { cwd: PROJECT, stdio: 'inherit', shell: true });
    // 等就绪
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await checkServer()) break;
    }
  }
  console.log('✅ 本地服务正常: http://localhost:3000\n');
  startTunnel();

  // 保持进程运行
  process.on('SIGINT', () => {
    console.log('\n正在关闭隧道...');
    try { if (ssh) ssh.kill(); } catch (e) {}
    process.exit(0);
  });
}

main();
