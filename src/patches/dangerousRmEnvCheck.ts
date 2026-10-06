// Please see the note about writing patches in ./index

import { showDiff } from './index';

/**
 * Check `rm $VAR/...` targets against the variable's actual value.
 *
 * Claude Code asks before any `rm` whose target starts with a variable
 * (`rm -rf "$DIR/"`, `rm -r ${BUILD}/*`), because an empty variable would
 * turn it into `rm -rf /`. The ask can't be allowed by permission rules and
 * fires even with --dangerously-skip-permissions, including when the variable
 * holds a harmless path.
 *
 * This patch works out every value each variable can have when the `rm` runs
 * and lets the command through only if all of them are deletable:
 * - `X=1; rm -rf $X/` and `X=1 && rm -rf $X/` use the assigned value. An
 *   assignment that might not run (after `||`, inside `( )`, ...) adds its
 *   value but keeps the outer value as a candidate too.
 * - `X=1 rm -rf $X/` uses the outer value: bash expands `$X` before the prefix
 *   assignment applies, so with X unset this is `rm -rf /`.
 * - Outer values come from the Bash tool's own shell: the shell Claude Code
 *   runs commands in is started the same way (same environment, `-l` only
 *   without a snapshot, the snapshot sourced) and asked for the variables, so
 *   startup files like ~/.zshenv count. Variables Claude Code sets itself for
 *   each command (TMPDIR, PATH, session variables, ...) can't be known here.
 * - An unset, empty or unknown value, or one with spaces, globs, `~` or
 *   expansions, keeps the prompt.
 * - Any other use of the name (`for X in`, `read X`) or a builtin that can set
 *   variables indirectly (`source`, `.`, `eval`, `declare`, `printf -v`, ...)
 *   keeps the prompt.
 * Each resulting path, resolved against the working directory, must be at
 * least two levels deep, must not be the home directory or one of its
 * parents, and must pass Claude Code's own literal-path check (system
 * directories, working directories and their parents, symlinks resolved).
 *
 * When the prompt still shows, it ends with what the variables resolved to
 * and why that path isn't safe, e.g. "with $BUILD = `/` (from the Bash tool's
 * environment), this removes `/`, the filesystem root."
 *
 * CC 2.1.296:
 * ```diff
 *  var Rgn=...,cbr=["SHELL","GIT_EDITOR","CLAUDECODE",...];
 *  function kun(){return kX().lastCheckedSessionEnvVarKeys}
 *  async function zgn(e,n){...y=Rgn(e,n?.pluginBinPaths??[]).then((M)=>{
 * +  globalThis.__tweakccShell={path:e,snapshot:M};
 *    s=M;...})...}
 *  function hwe(e,n){...r={...,evalStrings:!0,
 *    skipAssignedOriginalHits:n.skipAssignedOriginalHits
 * +  ,__tweakccWholeCommand:n.wholeCommand??e
 *  }...}
 * +function H(t,cmd,word){...execFileSync(shell,["-c",...,probe],{env:{...Ss(),...}})...
 * +  return bG(w,[path],se(),void 0,!1).behavior!=="ask"...}
 *  function Pwr(e,n,r,s,h){let{command:y,tokens:b}=e;for(...){...
 *    let z=h.derived.get(...),V=Xun(M,h.mayBeUnset),X=Kun.test(M)||n&&Kbr.test(M);
 *    if(X&&h.skipAssignedOriginalHits===!0&&...)continue;
 * +  let N;if((X||V!==void 0)&&z===void 0){let q=H(M,h.__tweakccWholeCommand,y);
 * +    if(q===!0)continue;N=q||void 0}
 * -  if(X||V!==void 0||z!==void 0){...return{command:y,target:...}}
 * +  if(X||V!==void 0||z!==void 0){...return{__tweakccRmNote:N,command:y,target:...}}
 *  ...
 *  function pwe(e,n){
 * +  if(e.__tweakccRmNote){let o=pwe({...e,__tweakccRmNote:void 0},n);
 * +    return{...o,message:o.message+"\n\n"+e.__tweakccRmNote}}
 *    let{command:r,target:s,invocation:h,reparsed:y}=e,...
 * ```
 */

const MARKER = '/* tweakcc:dangerous-rm-env-check */';

// The per-argument loop that reports `rm` targets built from variables.
// Groups: setup statements, derived hit, context, root-child hit, argument,
// variable-led hit, and the reporting `if`.
const LOOP_PATTERN =
  /(let ([$\w]+)=([$\w]+)\.derived\.get\([^;]*?,([$\w]+)=[$\w]+\(([$\w]+),\3\.mayBeUnset\),([$\w]+)=[^;]*;if\(\6&&\3\.skipAssignedOriginalHits===!0&&[^;]*\)continue;)(if\(\6\|\|\4!==void 0\|\|\2!==void 0\)\{)/;

// Where the variable-target check builds the context its loop receives; the
// whole command is stored on it, since the loop only sees one segment.
// Groups: the statements up to the end of the context object, the options,
// and the command.
const CONTEXT_PATTERN =
  /(\.assignments\?\?[$\w]+\(([$\w]+)\.wholeCommand\?\?([$\w]+),\2\.mayBeUnset\);[^;]*?evalStrings:!0,skipAssignedOriginalHits:\2\.skipAssignedOriginalHits)\}/;

const WHOLE_COMMAND = '__tweakccWholeCommand';
const NOTE = '__tweakccRmNote';
const SHELL = '__tweakccShell';

// The function that turns a variable-target hit into the prompt. It gets the
// note appended to its message. Groups: the header, the function, the hit,
// the second argument.
const PROMPT_PATTERN =
  /(function ([$\w]+)\(([$\w]+),([$\w]+)\)\{)(?=let\{command:[$\w]+,target:[$\w]+,invocation:[$\w]+,reparsed:[$\w]+\}=\3,)/;

// The loop's function header, which names the command (normalized, e.g. "rm").
const HEADER_PATTERN =
  /function [$\w]+\(([$\w]+)(?:,[$\w]+)*\)\{let\{command:([$\w]+),tokens:[$\w]+\}=\1;/g;

// Claude Code's literal-target check, applied to rm arguments.
const LITERAL_CHECK_PATTERN =
  /([$\w]+)=([$\w]+)\([$\w]+,[$\w]+,[$\w]+,[$\w]+,[$\w]+\);if\(\1\.behavior==="ask"\)return\{result:\1,kind:"literalTarget"\}/;

// The current working directory getter, passed to the literal-target check.
const CWD_PATTERN =
  /await [$\w]+\([$\w]+,([$\w]+)\(\),[$\w]+,[$\w]+,[$\w]+,[$\w]+,[$\w]+\);if\([$\w]+!==null\)return [$\w]+\("tengu_bash_dangerous_rm_too_complex"/;

// Where the Bash tool's shell snapshot is created; its shell path and
// snapshot path are recorded there. Groups: the code up to the callback body,
// the shell path, and the snapshot path.
const SNAPSHOT_PATTERN =
  /([$\w]+\(([$\w]+),[$\w]+\?\.pluginBinPaths\?\?\[\]\)\.then\(\(([$\w]+)\)=>\{)/;

// The environment Claude Code starts its shells with.
const SPAWN_ENV_PATTERN =
  /env:\{\.\.\.process\.env\.CLAUDE_CODE_DONT_INHERIT_ENV\?\{\}:([$\w]+)\(\),SHELL:[$\w]+,GIT_EDITOR:"true",CLAUDECODE:"1"\}/;

// Variables Claude Code overrides in every command's environment.
const OVERRIDES_PATTERN = /var ([$\w]+)=\["SHELL","GIT_EDITOR","CLAUDECODE",/;

// The session environment variables Claude Code adds to every command.
const SESSION_KEYS_PATTERN =
  /function ([$\w]+)\(\)\{return [$\w]+\(\)\.lastCheckedSessionEnvVarKeys\}/;

/** Picks a helper name that the source doesn't already use. */
const helperName = (source: string): string => {
  let name = '__tweakccEnvSafeRmTarget';
  while (source.includes(name)) name += '_';
  return name;
};

// Decides whether an rm argument built from variables is safe to run. Returns
// true if so; otherwise a note for the prompt explaining what the variables
// resolve to and why the path isn't safe ("" when there's nothing to say).
// Placeholders name Claude Code's literal rm check, cwd getter, spawn
// environment, per-command overrides and session variable keys.
// Written without backticks or "${" so it can live in a raw template.
const HELPER_SOURCE = String.raw`function __NAME__(t,cmd,word){try{
let w=String(word).replace(/^.*\//,"");if(w!=="rm"&&w!=="rmdir"||typeof cmd!=="string")return"";
let q=(v)=>"\x60"+v+"\x60",lead="Resolved by tweakcc: ",cant=lead+"couldn't resolve the variables in "+q(t)+": ",where=" in the Bash tool's environment";
let g=/(?:^|[\s;&|()\x60{}!])(source|\.|eval|declare|typeset|local|readonly|read|printf|mapfile|readarray|getopts|let|unset)(?=[\s;&|()]|$)/.exec(cmd);
if(g)return cant+"the command uses "+q(g[1])+", which can set variables this check can't follow.";
for(let m of cmd.matchAll(/(?:^|[\s;&|()\x60{}!])export(?=[\s;&|()]|$)/g))if(!/^export(?:\s+[A-Za-z_][A-Za-z0-9_]*=(?:"[^"$\x60\\]*"|'[^']*'|[^\s;&|()<>"'$\x60\\]*))+\s*(?:[;&|\n)]|$)/.test(cmd.slice(m.index+m[0].indexOf("export"))))return cant+"the command uses "+q("export")+" with something other than a plain NAME=value.";
let u=t.replace(/["']/g,""),V=/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
if(/[\x60\\\n-]/.test(u)||/\$/.test(u.replace(V,"")))return cant+"it uses an expansion other than a plain $NAME.";
let names=[...new Set([...u.matchAll(V)].map((m)=>m[1]??m[2]))];if(names.length===0)return"";
let at=cmd.indexOf(t);if(at<0)return"";
let cwd=String(__CWD__()).replace(/\/+$/,"");
let probe=(ns)=>{try{if(process.platform==="win32")return null;
let s=globalThis.__SHELL__,cp=process.getBuiltinModule?.("child_process"),fs=process.getBuiltinModule?.("fs");if(!s||!cp||!fs)return null;
let snap=typeof s.snapshot==="string"&&fs.existsSync(s.snapshot)?s.snapshot:void 0,mark="__tweakcc_"+Math.random().toString(36).slice(2)+"__",sq=(v)=>"'"+String(v).replace(/'/g,"'\\''")+"'";
let script=(snap?". "+sq(snap)+" 2>/dev/null || true; ":"")+"printf '%s\\0' "+sq(mark)+"; "+ns.map((n)=>"if [ -n \"$"+"{"+n+"+x}\" ]; then printf 'S%s\\0' \"$"+n+"\"; else printf 'U\\0'; fi").join("; ");
let out=cp.execFileSync(s.path,["-c",...(snap?[]:["-l"]),script],{env:{...(process.env.CLAUDE_CODE_DONT_INHERIT_ENV?{}:__SPAWNENV__()),SHELL:s.path,GIT_EDITOR:"true",CLAUDECODE:"1"},cwd:cwd||void 0,timeout:5000,stdio:["ignore","pipe","ignore"],encoding:"utf8",maxBuffer:4194304});
let parts=String(out).split("\0"),i=parts.findLastIndex((x)=>x.endsWith(mark));if(i<0||parts.length<i+1+ns.length)return null;
let m=new Map();for(let k=0;k<ns.length;k++){let v=parts[i+1+k];if(v.startsWith("S"))m.set(ns[k],v.slice(1));else if(v!=="U")return null}return m}catch{return null}};
let shellEnv,envOf=(n)=>{if(shellEnv===void 0)shellEnv=probe([...new Set([...names,"HOME"])]);return shellEnv===null?null:shellEnv.get(n)};
let bad=(v)=>v===""?"is empty":/\s/.test(v)?"contains spaces":/[*?[\]{}]/.test(v)?"contains glob characters":/~/.test(v)?"contains ~":/[$\x60\\]/.test(v)?"contains an expansion":"";
let emptied=(n)=>u.replace(V,(m,a,b)=>(a??b)===n?"":m);
let values=(n)=>{let out=[],set=!1,prefix=!1,re=new RegExp("(^|[^$\\w{])"+n+"(?![\\w])","g"),m;
let odd=(i)=>cant+"$"+n+" is set or used in a way this check can't follow ("+q(cmd.slice(Math.max(0,i-16),i+n.length+16).trim())+").";
while((m=re.exec(cmd))!==null){let i=m.index+m[1].length,before=cmd.slice(0,i).replace(/export\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*$/,""),rest=cmd.slice(i+n.length);
let a=/^=("[^"]*"|'[^']*'|[^\s;&|()<>"']*)/.exec(rest);if(a===null||!/(?:^|[;&|\n(){}!])\s*$/.test(before))return odd(i);
let after=rest.slice(a[0].length);
if(!/^\s*(?:;|&&|\|\||\n|\)|$)/.test(after)&&!/^export\s/.test(cmd.slice(before.length,i))){if(/^\s+[A-Za-z_][A-Za-z0-9_]*=/.test(after))return odd(i);prefix=!0;continue}
let v=a[1].replace(/^(["'])([\s\S]*)\1$/,"$2"),why=bad(v);if(why)return lead+"$"+n+" is assigned "+q(v)+", which "+why+", so this check can't tell what "+q(t)+" removes.";
out.push({v,src:"assigned in this command"});
if(i<at&&/(?:^|[;\n])\s*$/.test(before)&&!/&&|\|\||[(){}]|\b(?:if|then|else|elif|while|until|do|for|case)\b/.test(before))set=!0}
if(!set){let hint=prefix?" (a prefix assignment like "+q(n+"=...")+" only sets it for the command it precedes, not for $"+n+" on the same line)":"";
if(n==="PATH"||__OVERRIDES__.includes(n)||__SESSIONKEYS__()?.has?.(n))return cant+"Claude Code sets $"+n+" itself for each command, so this check can't tell its value.";
let e=envOf(n);if(e===null)return cant+"couldn't read the Bash tool's environment.";
if(e===void 0||e==="")return lead+"$"+n+(e===""?" is empty":" isn't set")+where+hint+", so "+q(t)+" could expand to "+q(emptied(n)||"(nothing)")+".";
let why=bad(e);if(why)return lead+"$"+n+" is "+q(e)+where+", which "+why+", so this check can't tell what "+q(t)+" removes.";
out.push({v:e,src:"from the Bash tool's environment"})}
return out};
let combos=[{}];for(let n of names){let vs=values(n);if(typeof vs==="string")return vs;let next=[];for(let c of combos)for(let v of vs)next.push({...c,[n]:v});combos=next;if(combos.length>16)return cant+"too many possible values."}
let homes=[process.env.HOME,shellEnv?.get?.("HOME")].filter((h)=>typeof h==="string"&&h!=="").map((h)=>h.replace(/\/+$/,""));if(homes.length===0)return cant+"$HOME isn't set.";
for(let c of combos){let s=u.replace(V,(m,a,b)=>c[a??b].v),p=[];
for(let x of (s.startsWith("/")?s:cwd+"/"+s).split("/")){if(x===""||x===".")continue;if(x==="..")p.pop();else p.push(x)}
let full="/"+p.join("/");while(p.length&&/^\*+$/.test(p[p.length-1]))p.pop();
let r="/"+p.join("/"),why="";
if(p.some((x)=>/[*?[\]{}~]/.test(x)))why="which has a glob this check can't resolve";
else if(p.length===0)why="the filesystem root";
else if(p.length===1)why="a top-level directory";
else if(homes.includes(r))why="your home directory";
else if(homes.some((h)=>h.startsWith(r+"/")))why="a parent of your home directory";
else{let o=__CHECK__(w,[full],cwd,void 0,!1);if(o.behavior==="ask")why="which Claude Code's path check flags: "+(String(o.message).split("\n\n")[1]??"protected path").split(". This requires")[0].replace(/\.$/,"")}
if(why)return lead+"with "+names.map((n)=>"$"+n+" = "+q(c[n].v)+" ("+c[n].src+")").join(" and ")+", this removes "+q(full)+", "+why+"."}
return!0}catch{return""}}`;

const helperFunction = (names: Record<string, string>): string =>
  // Function replacers: minified names may contain `$`, which a replacement
  // string would treat as a pattern.
  Object.entries(names).reduce(
    (source, [placeholder, value]) =>
      source.replaceAll(placeholder, () => value),
    HELPER_SOURCE
  );

/** Matches a pattern, logging which part of the check it couldn't find. */
const find = (
  source: string,
  pattern: RegExp,
  what: string
): RegExpMatchArray | null => {
  const match = source.match(pattern);
  if (!match || match.index === undefined) {
    console.error(`patch: dangerousRmEnvCheck: failed to find ${what}`);
    return null;
  }
  return match;
};

/**
 * Patches one source. Returns it unchanged if already patched, or null if the
 * dangerous rm check isn't in it.
 */
export const writeDangerousRmEnvCheck = (oldFile: string): string | null => {
  if (oldFile.includes(MARKER)) return oldFile;

  const loop = find(oldFile, LOOP_PATTERN, 'the variable target loop');
  if (!loop) return null;
  const [, setup, derived, context, rootChild, arg, varHit] = loop;

  let header: RegExpExecArray | undefined;
  for (const candidate of oldFile
    .slice(0, loop.index)
    .matchAll(HEADER_PATTERN)) {
    header = candidate;
  }
  if (!header || header.index === undefined) {
    console.error(
      'patch: dangerousRmEnvCheck: failed to find the loop function'
    );
    return null;
  }
  const [, , segmentCommand] = header;

  const reportAnchor = `return{command:${segmentCommand},target:`;
  const reportIndex = oldFile.indexOf(reportAnchor, loop.index);
  if (reportIndex < 0) {
    console.error('patch: dangerousRmEnvCheck: failed to find the loop report');
    return null;
  }

  const prompt = find(oldFile, PROMPT_PATTERN, 'the prompt builder');
  const contextMatch = find(oldFile, CONTEXT_PATTERN, 'the check context');
  const snapshot = find(oldFile, SNAPSHOT_PATTERN, 'the shell snapshot');
  const literalCheck = find(
    oldFile,
    LITERAL_CHECK_PATTERN,
    'the literal rm check'
  )?.[2];
  const cwd = find(oldFile, CWD_PATTERN, 'the cwd getter')?.[1];
  const spawnEnv = find(oldFile, SPAWN_ENV_PATTERN, 'the shell env')?.[1];
  const overrides = find(oldFile, OVERRIDES_PATTERN, 'the env overrides')?.[1];
  const sessionKeys = find(
    oldFile,
    SESSION_KEYS_PATTERN,
    'the session env keys'
  )?.[1];
  if (
    !prompt ||
    !contextMatch ||
    !snapshot ||
    !literalCheck ||
    !cwd ||
    !spawnEnv ||
    !overrides ||
    !sessionKeys
  ) {
    return null;
  }

  const [, promptHead, promptFn, hit, promptArg] = prompt;
  const promptInsert = `if(${hit}.${NOTE}){let o=${promptFn}({...${hit},${NOTE}:void 0},${promptArg});return{...o,message:o.message+"\\n\\n"+${hit}.${NOTE}}}`;

  const [, contextHead, options, command] = contextMatch;
  const contextInsert = `,${WHOLE_COMMAND}:${options}.wholeCommand??${command}`;

  const [snapshotHead, , shellPath, snapshotPath] = snapshot;
  const snapshotInsert = `globalThis.${SHELL}={path:${shellPath},snapshot:${snapshotPath}};`;

  const name = helperName(oldFile);
  const note = `${name}Note`;
  const skip = `let ${note};if((${varHit}||${rootChild}!==void 0)&&${derived}===void 0){let q=${name}(${arg},${context}.${WHOLE_COMMAND},${segmentCommand});if(q===!0)continue;${note}=q||void 0}`;
  const loopIndex = loop.index! + setup.length;
  const helper =
    MARKER +
    helperFunction({
      __NAME__: name,
      __CHECK__: literalCheck,
      __CWD__: cwd,
      __SPAWNENV__: spawnEnv,
      __OVERRIDES__: overrides,
      __SESSIONKEYS__: sessionKeys,
      __SHELL__: SHELL,
    });

  // Insert from the end so earlier offsets stay valid.
  const inserts: [number, string][] = [
    [header.index, helper],
    [loopIndex, skip],
    [contextMatch.index! + contextHead.length, contextInsert],
    [reportIndex + 'return{'.length, `${NOTE}:${note},`],
    [prompt.index! + promptHead.length, promptInsert],
    [snapshot.index! + snapshotHead.length, snapshotInsert],
  ];
  inserts.sort(([a], [b]) => b - a);
  let newFile = oldFile;
  for (const [index, text] of inserts) {
    newFile = newFile.slice(0, index) + text + newFile.slice(index);
  }

  showDiff(oldFile, newFile, skip, loopIndex, loopIndex);
  return newFile;
};
