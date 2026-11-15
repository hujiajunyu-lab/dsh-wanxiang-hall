/**
 * 验收命令执行器：宿主侧跑 test/lint/build，记录 exit code、耗时、日志摘要。
 *
 * 设计约束：
 * - 只执行项目里登记过的 checks（由架构师/项目经理在开工前写入），不接受任意命令。
 * - 命令在项目工作区执行，顺序执行，避免测试之间互相踩文件。
 * - 完整日志写到 ~/.dsh/court/verifications/，状态里只存尾部摘要和 sha256。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeId } from './store.js';

const MAX_CHECKS = 10;
const MAX_COMMAND_CHARS = 2000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const TAIL_CHARS = 4096;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_TIMEOUT_MS = 5 * 1000;
const MAX_TIMEOUT_MS = 15 * 60 * 1000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeId(text) {
  return String(text ?? 'check').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'check';
}

const SHELLS = new Set(['auto', 'cmd', 'pwsh', 'powershell', 'bash']);

export function normalizeShell(value) {
  const shell = String(value ?? 'auto').trim().toLowerCase();
  return SHELLS.has(shell) ? shell : 'auto';
}

export function resolveShell(check) {
  const shell = normalizeShell(check?.shell);
  if (shell !== 'auto') return shell;
  return process.platform === 'win32' ? 'cmd' : 'bash';
}

export function normalizeChecks(raw, { strict = false } = {}) {
  if (!Array.isArray(raw)) {
    if (strict) throw new Error('checks 必须是数组');
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const [index, item] of raw.entries()) {
    if (out.length >= MAX_CHECKS) {
      if (strict) throw new Error(`checks 最多 ${MAX_CHECKS} 条`);
      break;
    }
    if (!item || typeof item !== 'object') {
      if (strict) throw new Error(`第 ${index + 1} 条 check 不是对象`);
      continue;
    }
    const id = String(item.id ?? `check${index + 1}`).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(id)) {
      if (strict) throw new Error(`check id 不合法：${id}（字母开头，字母/数字/_/-，最长 32）`);
      continue;
    }
    if (seen.has(id)) {
      if (strict) throw new Error(`check id 重复：${id}`);
      continue;
    }
    const command = String(item.command ?? '').trim();
    if (!command || command.length > MAX_COMMAND_CHARS) {
      if (strict) throw new Error(`check ${id} 的命令为空或超过 ${MAX_COMMAND_CHARS} 字符`);
      continue;
    }
    const shell = normalizeShell(item.shell);
    if (strict && shell === 'powershell' && /(^|[^&])&&|\|\|/.test(command)) {
      throw new Error(
        `check ${id} 显式使用 powershell（5.1）但命令含 &&/||；` +
        '改用 shell:"cmd"（推荐，npm 脚本可用 &&）或 shell:"pwsh"（PowerShell 7）',
      );
    }
    const timeoutMs = clamp(
      Number.isFinite(item.timeoutMs) ? Number(item.timeoutMs) : DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );
    out.push({ id, command, timeoutMs, shell });
    seen.add(id);
  }
  if (strict && out.length === 0) throw new Error('至少需要一条 check');
  return out;
}

/**
 * Windows 控制台命令（cmd.exe）的报错是 GBK 字节，直接按 utf8 解会变成乱码，
 * 于是「不是内部或外部命令」这类判定全部失效、预跑会把假命令当成功。
 * 先按 utf8 解，出现替换字符再按 GBK 解一次。
 */
let gbkDecoder = null;
try {
  gbkDecoder = new TextDecoder('gbk');
} catch {
  gbkDecoder = null;
}

function decodeBuffer(buf) {
  const utf8 = buf.toString('utf8');
  if (!gbkDecoder || !utf8.includes('\uFFFD')) return utf8;
  try {
    return gbkDecoder.decode(buf);
  } catch {
    return utf8;
  }
}

function shellSpec(command, shell = 'auto') {
  const resolved = shell === 'auto'
    ? (process.platform === 'win32' ? 'cmd' : 'bash')
    : shell;
  if (process.platform === 'win32') {
    if (resolved === 'cmd') {
      return [{ file: 'cmd.exe', args: ['/d', '/s', '/c', command] }];
    }
    if (resolved === 'bash') {
      return [{ file: 'bash', args: ['-lc', command] }];
    }
    if (resolved === 'powershell') {
      return [{ file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] }];
    }
    return [
      { file: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', command] },
      { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] },
    ];
  }
  return [{ file: 'bash', args: ['-lc', command] }];
}

function spawnOnce(file, args, { cwd, timeoutMs, env }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        windowsHide: true,
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ exitCode: -1, signal: null, timedOut: false, stdout: '', stderr: '', error, truncated: false, program: file });
      return;
    }

    const startedAt = Date.now();
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const hash = createHash('sha256');
    let timer = null;

    const collect = (target, chunk, which) => {
      hash.update(chunk);
      if (which === 'stdout') {
        if (stdoutBytes < MAX_OUTPUT_BYTES) {
          target.push(chunk);
          stdoutBytes += chunk.length;
        } else {
          truncated = true;
        }
      } else if (stderrBytes < MAX_OUTPUT_BYTES) {
        target.push(chunk);
        stderrBytes += chunk.length;
      } else {
        truncated = true;
      }
    };

    child.stdout.on('data', (chunk) => collect(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => collect(stderr, chunk, 'stderr'));

    const finish = (exitCode, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        signal: signal ?? null,
        timedOut,
        stdout: decodeBuffer(Buffer.concat(stdout)),
        stderr: decodeBuffer(Buffer.concat(stderr)),
        error: error ?? null,
        truncated,
        durationMs: Date.now() - startedAt,
        outputSha256: hash.digest('hex'),
        program: file,
      });
    };

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      // 给进程 5 秒收尾；仍未退出就强杀并按超时结算。
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
        finish(-1, null, new Error(`命令超时（${timeoutMs}ms）`));
      }, 5000).unref?.();
    }, timeoutMs);

    child.on('error', (error) => finish(-1, null, error));
    child.on('close', (code, signal) => finish(code ?? -1, signal, null));
  });
}

async function buildCheckEnv() {
  const env = { ...process.env };
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const root = path.join(home, 'dsh-runtimes');
  const extra = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const deps = path.join(root, entry.name, 'dependencies');
      extra.push(
        path.join(deps, 'node'),
        path.join(deps, 'node', 'bin'),
        path.join(deps, 'python'),
        path.join(deps, 'python', 'Scripts'),
        path.join(deps, 'pnpm'),
      );
    }
  } catch {
    /* 没有 runtime 目录就保持原环境 */
  }
  const current = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const merged = [...new Set([...extra, ...current])].join(path.delimiter);
  env.PATH = merged;
  env.Path = merged;
  return env;
}

export async function probeShell(shell) {  const resolved = normalizeShell(shell) === 'auto'
    ? (process.platform === 'win32' ? 'cmd' : 'bash')
    : normalizeShell(shell);
  const env = await buildCheckEnv();
  const result = await runCommand('exit 0', process.cwd(), 10000, resolved, env);
  if (result.error || result.exitCode !== 0) {
    throw new Error(
      `验收命令的 shell「${resolved}」不可用：${result.error?.message ?? `exit ${result.exitCode}`}；` +
      '请改用 shell:"cmd"（Windows 推荐）或 shell:"bash"/"pwsh"',
    );
  }
  if (resolved === 'pwsh' && result.program === 'powershell.exe') {
    throw new Error(
      'shell:"pwsh" 不可用，宿主只有 Windows PowerShell 5.1；' +
      '请改用 shell:"cmd"（支持 &&，推荐）或 shell:"powershell"（不支持 &&）',
    );
  }
  return resolved;
}

/**
 * 预跑（envProbe）：登记验收命令时立刻在**同一环境**里跑一遍。
 *
 * 只判「这条命令在这个 shell、这个目录里能不能起来」，不判「业务是否通过」——
 * 新项目代码还没写，`npm test` 红是正常的，不该因此拒绝登记。
 * 但「命令不存在 / shell 不认 / 编码炸了」这类问题必须当场暴露，
 * 否则要等工程师写完代码、跑到验收阶段才发现（拍照识物就这么卡过一次）。
 */
const PREFLIGHT_TIMEOUT_MS = 120 * 1000;

export async function preflightCheck(check, cwd) {
  const shell = resolveShell(check);
  const env = await buildCheckEnv();
  const timeoutMs = Math.min(Number(check.timeoutMs) || PREFLIGHT_TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS);
  let result;
  try {
    result = await runCommand(check.command, cwd, timeoutMs, shell, env);
  } catch (error) {
    return { id: check.id, ok: false, kind: 'env', detail: `命令起不来：${error?.message ?? error}` };
  }
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.error) {
    return { id: check.id, ok: false, kind: 'env', detail: `命令起不来：${result.error.message ?? result.error}` };
  }
  if (
    /不是内部或外部命令|is not recognized as|command not found|无法将.{0,20}项识别为|CommandNotFoundException|不是可运行的程序|operable program or batch file/i.test(
      text,
    )
  ) {
    return { id: check.id, ok: false, kind: 'env', detail: '命令不存在（PATH 里找不到）' };
  }
  // cmd 对「找不到命令」有专用退出码，语言/编码无关的最后一道保险。
  if (result.exitCode === 9009) {
    return { id: check.id, ok: false, kind: 'env', detail: '命令不存在（cmd 退出码 9009）' };
  }
  if (/UnicodeEncodeError|code page|invalid multibyte|编码.*错误/i.test(text)) {
    return { id: check.id, ok: false, kind: 'encoding', detail: '输出编码报错（GBK/UTF-8 不匹配），换 shell 或先设 chcp 65001' };
  }
  if (result.exitCode === 0) {
    return { id: check.id, ok: true, kind: 'ok', detail: '已经跑得通' };
  }
  if (result.timedOut) {
    return { id: check.id, ok: true, kind: 'slow', detail: `预跑超时（>${Math.round(timeoutMs / 1000)}s），命令至少在跑` };
  }
  return {
    id: check.id,
    ok: true,
    kind: 'nonzero',
    detail: `命令能执行，当前退出码 ${result.exitCode}（代码没写完属于正常）`,
  };
}

async function runCommand(command, cwd, timeoutMs, shell, env) {
  let last = null;
  for (const spec of shellSpec(command, shell)) {
    const result = await spawnOnce(spec.file, spec.args, { cwd, timeoutMs, env });
    last = result;
    if (!result.error || result.error.code !== 'ENOENT') return result;
  }
  return last;
}

async function runOne(check, cwd, verificationId, env) {
  const shell = resolveShell(check);
  const result = await runCommand(check.command, cwd, check.timeoutMs || DEFAULT_TIMEOUT_MS, shell, env);
  const logDir = process.env.COURT_STATE_DIR
    ? path.join(path.resolve(process.env.COURT_STATE_DIR), 'verifications')
    : path.join(os.homedir(), '.dsh', 'court', 'verifications');
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${verificationId}-${safeId(check.id)}.log`);
  const header = [
    `# check: ${check.id}`,
    `# command: ${check.command}`,
    `# shell: ${shell}`,
    `# cwd: ${cwd}`,
    `# exitCode: ${result.exitCode}`,
    `# timedOut: ${result.timedOut}`,
    `# durationMs: ${result.durationMs}`,
    `# truncated: ${result.truncated}`,
    '',
    '## stdout',
    result.stdout,
    '',
    '## stderr',
    result.stderr,
    '',
  ].join('\n');
  try {
    await fs.writeFile(logPath, header, 'utf8');
  } catch {
    /* 日志写不进去不影响结论 */
  }

  const ok = result.exitCode === 0 && !result.timedOut && !result.error;
  return {
    id: check.id,
    command: check.command,
    shell,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ok,
    timedOut: result.timedOut,
    truncated: result.truncated,
    stdoutTail: result.stdout.slice(-TAIL_CHARS),
    stderrTail: result.stderr.slice(-TAIL_CHARS),
    logSha256: result.outputSha256,
    logPath,
    error: result.error ? String(result.error.message ?? result.error) : '',
  };
}

export async function runChecks(project, { checkIds = [], by = 'unknown' } = {}) {
  const all = Array.isArray(project.checks) ? project.checks : [];
  const wanted = Array.isArray(checkIds) ? checkIds.filter(Boolean) : [];
  if (wanted.length > 0) {
    const known = new Set(all.map((check) => check.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`未登记的 check：${unknown.join('、')}`);
  }
  const selected = wanted.length > 0 ? all.filter((check) => wanted.includes(check.id)) : all;
  const workspace = project.workspace && project.workspace.path;
  if (!workspace) throw new Error('项目还没有工作区，不能跑验收命令');

  const verificationId = selected.length > 0 ? makeId('v') : '';
  const checks = [];
  const env = await buildCheckEnv();
  for (const check of selected) {
    checks.push(await runOne(check, workspace, verificationId, env));
  }
  return {
    id: verificationId,
    at: Date.now(),
    by,
    workspace,
    commit: project.baseline ? project.baseline.commit ?? null : null,
    ok: checks.length === 0 ? true : checks.every((check) => check.ok),
    skipped: checks.length === 0,
    checks,
  };
}

export function lastVerification(project) {
  const list = Array.isArray(project.verifications) ? project.verifications : [];
  return list[list.length - 1] ?? null;
}

export function checkHint(verification) {
  if (!verification || !Array.isArray(verification.checks)) return '';
  const failed = verification.checks.filter((check) => !check.ok);
  if (failed.length === 0) return '';
  const text = failed.map((check) => `${check.stdoutTail ?? ''}\n${check.stderrTail ?? ''}`).join('\n');
  if (/not recognized|不是内部或外部命令|command not found|No such file or directory|无法将.*识别/i.test(text)) {
    return '命令不存在或 PATH 缺 node/python/npm：先在宿主终端确认 `npm -v` / `python --version` 能跑，再重试 court_verify。';
  }
  if (failed.length > 1) {
    const first = failed[0];
    const identical = failed.every((check) => (
      check.logSha256 === first.logSha256
      && !String(check.stdoutTail ?? '').trim()
      && !String(check.stderrTail ?? '').trim()
    ));
    if (identical) {
      return '所有失败 check 的日志哈希完全相同且为空：这通常不是代码失败，而是 shell 方言/命令不存在/工作目录不对；检查 check.shell 与命令本身。';
    }
  }
  return '';
}

export function summarizeChecks(verification) {
  if (!verification || !Array.isArray(verification.checks)) return [];
  return verification.checks.map((check) => ({
    id: check.id,
    command: check.command,
    shell: check.shell ?? '',
    exit_code: check.exitCode,
    duration_ms: check.durationMs,
    ok: Boolean(check.ok),
    timed_out: Boolean(check.timedOut),
    stdout_tail: check.stdoutTail ?? '',
    stderr_tail: check.stderrTail ?? '',
    log_sha256: check.logSha256 ?? '',
    log_path: check.logPath ?? '',
  }));
}
