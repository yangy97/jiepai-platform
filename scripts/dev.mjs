#!/usr/bin/env node
/**
 * 一键启动：后端(7010) + 管理端(5178)
 * 用法：npm run dev        （需 Node 18+，建议 nvm use）
 * 可选：RESET_DB=1 npm run dev   先重置并灌入种子数据
 */
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`\n[dev] ${name} 退出(code=${code})，正在停止其它进程...`);
      stopAll(code);
    }
  });
  children.push(child);
  return child;
}

function stopAll(code = 0) {
  children.forEach((c) => {
    if (!c.killed) c.kill('SIGTERM');
  });
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

if (process.env.RESET_DB === '1') {
  console.log('[dev] 重置数据库并写入种子数据...');
  execSync('npm run db:reset', { cwd: root, stdio: 'inherit', shell: true });
}

console.log('[dev] 启动后端 http://127.0.0.1:7010  管理端 http://localhost:5178\n');
run('server', 'npm', ['run', 'dev'], path.join(root, 'server'));
run('admin', 'npm', ['run', 'dev'], path.join(root, 'admin'));
