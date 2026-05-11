const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const skillsDir = path.join(process.env.USERPROFILE, '.claude', 'skills');
if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

const skills = [
  { name: 'frontend-design', url: 'https://github.com/anthropics/skills/archive/refs/heads/main.zip', subdir: 'skills-main/frontend-design' },
  { name: 'skill-creator', url: 'https://github.com/anthropics/skills/archive/refs/heads/main.zip', subdir: 'skills-main/skill-creator' },
  { name: 'ui-ux-pro-max', url: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/archive/refs/heads/main.zip', subdir: 'ui-ux-pro-max-skill-main' },
  { name: 'superpowers', url: 'https://github.com/obra/superpowers/archive/refs/heads/main.zip', subdir: 'superpowers-main' }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function doGet(u) {
      https.get(u, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
        } else {
          res.pipe(file);
          res.on('end', () => { file.close(); resolve(); });
        }
      }).on('error', (e) => { file.close(); reject(e); });
    }
    doGet(url);
  });
}

async function main() {
  for (const skill of skills) {
    const target = path.join(skillsDir, skill.name);
    if (fs.existsSync(target)) {
      console.log('OK ' + skill.name + ' (already installed)');
      continue;
    }
    const zipPath = path.join(skillsDir, skill.name + '.zip');
    console.log('Downloading ' + skill.name + '...');
    try {
      await download(skill.url, zipPath);
      console.log('  Extracting...');
      execSync('powershell -Command "Expand-Archive -Path \\"' + zipPath + '\\" -DestinationPath \\"' + skillsDir + '\\" -Force"', { shell: true });
      const src = path.join(skillsDir, skill.subdir);
      if (fs.existsSync(src)) {
        fs.renameSync(src, target);
      }
      try { fs.unlinkSync(zipPath); } catch(e) {}
      console.log('OK ' + skill.name + ' installed');
    } catch (e) {
      console.log('FAIL ' + skill.name + ': ' + e.message);
    }
  }

  const installed = fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory());
  console.log('\nInstalled skills:');
  installed.forEach(s => console.log('  - ' + s));
}
main();
