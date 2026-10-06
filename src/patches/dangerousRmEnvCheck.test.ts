import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { writeDangerousRmEnvCheck } from './dangerousRmEnvCheck';

// Trimmed from CC 2.1.296 chunk-sfn1dbxq.js: the per-command env overrides,
// the session env keys, the shell env, the Bash tool's shell setup, the check
// context, the loop reporting variable-led rm targets, the literal-target
// check call, the call that passes the cwd, and the prompt builder.
const EXCERPT =
  'var cbr=["SHELL","GIT_EDITOR","CLAUDECODE","TMPDIR"];' +
  'function kun(){return kX().lastCheckedSessionEnvVarKeys}' +
  'async function Cgn(e){return{env:{...process.env.CLAUDE_CODE_DONT_INHERIT_ENV?{}:Ss(),SHELL:e,GIT_EDITOR:"true",CLAUDECODE:"1"}}}' +
  'async function zgn(e,n){let s,y=Rgn(e,n?.pluginBinPaths??[]).then((M)=>{s=M;return M});return y}' +
  'function hwe(e,n){let r=Jbr;if(n!==void 0){let{set:y,emptied:b,rootValued:w,derived:M}=n.assignments??s3e(n.wholeCommand??e,n.mayBeUnset);' +
  'r={mayBeUnset:(z)=>n.mayBeUnset(z),derived:M,assigned:new Set,evalStrings:!0,skipAssignedOriginalHits:n.skipAssignedOriginalHits}}return r}' +
  'function Pwr(e,n,r,s,h){let{command:y,tokens:b}=e;for(let w=0;w<b.length;w++){let M=b[w];' +
  'let z=h.derived.get(M),V=Xun(M,h.mayBeUnset),X=Kun.test(M)||n&&Kbr.test(M);' +
  'if(X&&h.skipAssignedOriginalHits===!0&&h.assigned.has(M))continue;' +
  'if(X||V!==void 0||z!==void 0){return{command:y,target:M}}}return null}' +
  'async function Xcn(ut,Ze,n,r,X){let pt=bG(ut,Ze,n,r,X);if(pt.behavior==="ask")return{result:pt,kind:"literalTarget"};return null}' +
  'async function MTr(r,n,h,y,b,w){let he=await Xcn(r,se(),n,h,y,b,w);if(he!==null)return dO("tengu_bash_dangerous_rm_too_complex",{});return null}' +
  'function pwe(e,n){let{command:r,target:s,invocation:h,reparsed:y}=e,b=[];return{behavior:"ask",message:`Dangerous ${r} operation on ${s}`}}';

// A real directory tree, since the Bash tool's shell is really run in it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'tweakcc-rm-'));
const CWD = path.join(ROOT, 'work', 'proj');
const HOME = path.join(ROOT, 'home', 'me');
fs.mkdirSync(CWD, { recursive: true });
fs.mkdirSync(HOME, { recursive: true });
const SNAPSHOT = path.join(ROOT, 'snapshot.sh');

type Hit = { command: string; target: string } | null;
type Context = Record<string, unknown>;

/** Environment the stubbed Claude Code starts the Bash tool's shell with. */
let shellEnv: Record<string, string> = {};
/** Session variables Claude Code adds to every command. */
let sessionKeys = new Set<string>();

/** Evaluates the patched code with stubbed internals, segment by segment. */
const load = (source: string) => {
  const { hwe, Pwr, pwe, zgn } = new Function(
    'Jbr',
    's3e',
    'Kun',
    'Kbr',
    'Xun',
    'bG',
    'se',
    'dO',
    'Ss',
    'kX',
    'Rgn',
    `${source};return{hwe,Pwr,pwe,zgn};`
  )(
    {},
    () => ({ derived: new Map() }),
    // Kun from CC 2.1.296: a target that starts with `$VAR/`.
    /^["']*\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?::?-(?:["']{2}|"?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?)?)?\}|[A-Za-z_][A-Za-z0-9_]*)["']*\\?\/(?:[*?[{]|\$|\/|["']||$)/,
    /$^/,
    () => undefined,
    // Stand-in for Claude Code's literal check: /usr and the working
    // directory and its parents.
    (_cmd: string, [target]: string[], cwd: string) => {
      const resolved = (target.startsWith('/') ? target : `${cwd}/${target}`)
        .replace(/\/\*$/, '')
        .replace(/\/+$/, '');
      return resolved === '/usr' ||
        resolved === cwd ||
        cwd.startsWith(`${resolved}/`)
        ? {
            behavior: 'ask',
            // Message format of CC 2.1.296's literal check.
            message: `Dangerous rm operation detected: '${target}'\n\nThis command would remove a workspace directory (the working directory, an additional working directory, or one of their parent directories). This requires explicit approval and cannot be auto-allowed by permission rules.`,
          }
        : { behavior: 'passthrough' };
    },
    () => CWD,
    () => undefined,
    () => shellEnv,
    () => ({ lastCheckedSessionEnvVarKeys: sessionKeys }),
    async () => SNAPSHOT
  ) as {
    hwe: (command: string, options: Context) => Context;
    pwe: (hit: Hit, n: boolean) => { message: string };
    Pwr: (
      segment: Context,
      n: boolean,
      r: boolean,
      s: boolean,
      h: Context
    ) => Hit;
    zgn: (shell: string, options: Context) => Promise<unknown>;
  };
  const check = (command: string): Hit => {
    const context = hwe(command, {
      wholeCommand: command,
      mayBeUnset: () => false,
    });
    for (const segment of command.split(/;|&&|\|\||\|/)) {
      // Like Claude Code, skip prefix assignments to find the command word.
      const words = segment.trim().split(/\s+/);
      while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
      const [word, ...tokens] = words;
      const hit = Pwr(
        { command: word, tokens, word },
        false,
        true,
        false,
        context
      );
      if (hit !== null) return hit;
    }
    return null;
  };
  const prompt = (command: string): string =>
    pwe(check(command), false).message;
  return { check, prompt, Pwr, zgn };
};

describe('writeDangerousRmEnvCheck', () => {
  let check: (command: string) => Hit;
  let prompt: (command: string) => string;

  beforeEach(async () => {
    const loaded = load(writeDangerousRmEnvCheck(EXCERPT)!);
    ({ check, prompt } = loaded);
    shellEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME,
      BUILD: `${CWD}/build`,
      EMPTY: '',
      ROOT: '/',
      SYS: '/usr',
      PROJ: CWD,
      SPACED: `${CWD}/a /`,
    };
    sessionKeys = new Set();
    fs.writeFileSync(SNAPSHOT, '# Snapshot file\n');
    // Records the Bash tool's shell, as Claude Code does when it starts.
    await loaded.zgn('/bin/sh', {});
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__tweakccShell;
  });

  afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('allows targets whose variables are set to a deletable path', () => {
    expect(check('rm -rf $BUILD/')).toBeNull();
    expect(check('rm -rf "${BUILD}"/*')).toBeNull();
    expect(check('rmdir $BUILD/')).toBeNull();
  });

  it('uses values assigned earlier in the command', () => {
    expect(check('X=1; rm -rf $X/')).toBeNull();
    expect(check('X=1 && rm -rf $X/')).toBeNull();
    expect(check('X="out" ; rm -rf $X/*')).toBeNull();
    expect(check('export X=out ; rm -rf $X/')).toBeNull();
  });

  it('uses the outer value for prefix assignments, like bash', () => {
    // With X unset, bash runs this as `rm -rf /`.
    expect(check('X=1 rm -rf $X/')).not.toBeNull();
    shellEnv.X = `${CWD}/build`;
    expect(check('X=1 rm -rf $X/')).toBeNull();
  });

  it("reads values from the Bash tool's shell, not Claude Code's process", () => {
    vi.stubEnv('BUILD', '/');
    expect(check('rm -rf $BUILD/')).toBeNull();
    vi.unstubAllEnvs();

    // Startup files and the snapshot run before the command; the second
    // variable is a plain shell variable that is never exported.
    fs.writeFileSync(
      SNAPSHOT,
      'echo noise from startup files\nBUILD=/\nexport OUT=out\nLOCAL=/\n'
    );
    expect(prompt('rm -rf $BUILD/')).toContain(
      "with $BUILD = `/` (from the Bash tool's environment), this removes `/`, the filesystem root."
    );
    expect(check('rm -rf $LOCAL/')).not.toBeNull();
    expect(check('rm -rf $OUT/')).toBeNull();
  });

  it('keeps the prompt for variables Claude Code sets for each command', () => {
    shellEnv.TMPDIR = `${CWD}/tmp`;
    sessionKeys.add('FROM_HOOK');
    shellEnv.FROM_HOOK = `${CWD}/hook`;
    expect(prompt('rm -rf $TMPDIR/')).toContain(
      "Claude Code sets $TMPDIR itself for each command, so this check can't tell its value."
    );
    expect(check('rm -rf $FROM_HOOK/')).not.toBeNull();
    expect(check('rm -rf $PATH/')).not.toBeNull();
  });

  it("keeps the prompt when the Bash tool's shell can't be read", () => {
    delete (globalThis as Record<string, unknown>).__tweakccShell;
    expect(prompt('rm -rf $BUILD/')).toContain(
      "couldn't read the Bash tool's environment."
    );
  });

  it('keeps the prompt when any possible value is dangerous', () => {
    expect(check('X=/; rm -rf $X/')).not.toBeNull();
    expect(check('true || X=1; rm -rf $X/')).not.toBeNull();
    expect(check('rm -rf $BUILD/; BUILD=/; rm -rf $BUILD/')).not.toBeNull();
    expect(check('X=$(pwd); rm -rf $X/')).not.toBeNull();
    expect(check('X=~/x; rm -rf $X/')).not.toBeNull();
    expect(check('X="a /"; rm -rf $X/')).not.toBeNull();
    expect(check('export X=/ ; rm -rf $X/')).not.toBeNull();
    expect(check('export X=$Y ; rm -rf $X/')).not.toBeNull();
  });

  it('keeps the prompt for unset, empty or unsplittable values', () => {
    expect(check('rm -rf $X/')).not.toBeNull();
    expect(check('rm -rf $EMPTY/')).not.toBeNull();
    expect(check('rm -rf $SPACED/')).not.toBeNull();
  });

  it('keeps the prompt for shallow, home and protected targets', () => {
    expect(check('rm -rf $ROOT/')).not.toBeNull();
    expect(check('rm -rf $ROOT/*')).not.toBeNull();
    expect(check('rm -rf $HOME/')).not.toBeNull();
    expect(check('rm -rf $SYS/')).not.toBeNull();
    expect(check('rm -rf $PROJ/*')).not.toBeNull();
    expect(check('X=.; rm -rf $X/*')).not.toBeNull();
  });

  it('keeps the prompt when the variable is set some other way', () => {
    expect(check('for X in a b ; do rm -rf $X/ ; done')).not.toBeNull();
    expect(check('source ./env.sh ; rm -rf $BUILD/')).not.toBeNull();
    expect(check('. ./env.sh && rm -rf $BUILD/')).not.toBeNull();
    expect(check('eval "$(cat f)" ; rm -rf $BUILD/')).not.toBeNull();
    expect(check('declare "$v=/" ; rm -rf $BUILD/')).not.toBeNull();
    expect(check('printf -v "$v" / ; rm -rf $BUILD/')).not.toBeNull();
    expect(check('read -r "$v" ; rm -rf $BUILD/')).not.toBeNull();
    expect(check('unset BUILD ; rm -rf $BUILD/')).not.toBeNull();
  });

  it('keeps the prompt for expansions it cannot evaluate', () => {
    expect(check('rm -rf ${BUILD:-$HOME}/')).not.toBeNull();
    expect(check('rm -rf $BUILD/$(echo x)')).not.toBeNull();
    expect(check('rm -rf $BUILD/*/cache')).not.toBeNull();
  });

  it('explains what the variables resolved to in the prompt', () => {
    expect(prompt('rm -rf $ROOT/')).toBe(
      'Dangerous rm operation on $ROOT/\n\nResolved by tweakcc: with $ROOT = `/` ' +
        "(from the Bash tool's environment), this removes `/`, the filesystem root."
    );
    expect(prompt('X=/usr; rm -rf $X/')).toContain(
      'with $X = `/usr` (assigned in this command), this removes `/usr`, a top-level directory.'
    );
    expect(prompt('rm -rf $HOME/')).toContain('your home directory.');
    expect(prompt('rm -rf $PROJ/*')).toContain(
      `this removes \`${CWD}/*\`, which Claude Code's path check flags: ` +
        'This command would remove a workspace directory (the working directory, ' +
        'an additional working directory, or one of their parent directories).'
    );
    expect(prompt('X=1 rm -rf $X/')).toContain(
      "$X isn't set in the Bash tool's environment (a prefix assignment like `X=...` " +
        'only sets it for the command it precedes, not for $X on the same line), ' +
        'so `$X/` could expand to `/`.'
    );
    expect(prompt('rm -rf $EMPTY/')).toContain('$EMPTY is empty');
    expect(prompt('X="a /"; rm -rf $X/')).toContain('which contains spaces');
    expect(prompt('source ./env.sh ; rm -rf $BUILD/')).toContain(
      'the command uses `source`'
    );
  });

  it('keeps the prompt without the whole command', () => {
    const { Pwr } = load(writeDangerousRmEnvCheck(EXCERPT)!);
    const hit = Pwr(
      { command: 'rm', tokens: ['-rf', '$BUILD/'], word: 'rm' },
      false,
      true,
      false,
      { derived: new Map(), mayBeUnset: () => false, assigned: new Set() }
    );
    expect(hit).not.toBeNull();
  });

  it('only applies to rm and rmdir', () => {
    expect(check('shred -rf $BUILD/')).not.toBeNull();
  });

  it('returns an already-patched source unchanged', () => {
    const patched = writeDangerousRmEnvCheck(EXCERPT)!;

    expect(writeDangerousRmEnvCheck(patched)).toBe(patched);
  });

  it('returns null when the check is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(writeDangerousRmEnvCheck('function f(){}')).toBeNull();
    spy.mockRestore();
  });
});
