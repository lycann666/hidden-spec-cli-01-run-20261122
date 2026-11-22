// main.ts is mend, the CLI SPEC.md specifies, and this is the kit's starting point for it (MIT). It does sections 1 to 4, 9 and 10 of SPEC.md: the command line, the output and
// exit codes, safe paths, format detection, JSON edits and the all-or-nothing write. The other three formats are
// detected and then read as holding no edit, so they answer `error: parse 1`: reading unified diffs (section 6),
// SEARCH/REPLACE blocks (section 7) and V4A patches (section 8), and matching lines at three tiers (section 5), are
// yours to write. Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this file hands over to runner.ts
// (the last lines below): keep that hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Moves that succeeded, in order, for the `R old -> new` output lines. */
  readonly moves: { old: string; new: string }[] = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/** A file's lines, its line break and whether it ends with one (SPEC.md section 3). */
interface FileState {
  lines: string[];
  br: string;
  finalBreak: boolean;
}

function parseFile(text: string): FileState {
  if (text === '') return { lines: [], br: '\n', finalBreak: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const finalBreak = text.endsWith(br);
  if (finalBreak) parts.pop();
  return { lines: parts, br, finalBreak };
}

function renderFile(f: FileState): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.finalBreak ? f.br : '');
}

function leadWs(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
}

/** Line equality at one matching tier (SPEC.md section 5). */
function tierEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  const trimEnd = (s: string): string => s.replace(/[ \t]+$/, '');
  if (tier === 1) return trimEnd(a) === trimEnd(b);
  const trimBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  return trimBoth(a) === trimBoth(b);
}

function findOccurrences(lines: string[], o: string[], tier: number, from: number): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  for (let i = from; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < o.length; j++) {
      if (!tierEq(lines[i + j]!, o[j]!, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier at which O occurs at or after `from`, with its positions. */
function matchTier(lines: string[], o: string[], strict: boolean, from: number): { tier: number; pos: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const pos = findOccurrences(lines, o, t, from);
    if (pos.length > 0) return { tier: t, pos };
  }
  return null;
}

/** One line of N: a context line (written as the file's own line) or an added line. */
interface NLine {
  text: string;
  isContext: boolean;
  oIdx: number;
}

/** N with context lines taken from the file and tier-2 re-indentation applied. */
function buildReplacement(fileLines: string[], at: number, o: string[], n: NLine[], tier: number): string[] {
  const f = fileLines[at] ?? '';
  const p = o.length > 0 ? o[0]! : '';
  const F = leadWs(f);
  const P = leadWs(p);
  return n.map((item) => {
    if (item.isContext) return fileLines[at + item.oIdx]!;
    if (tier === 2) {
      const t = item.text;
      if (t !== '' && t.trim() !== '' && t.startsWith(P)) return F + t.slice(P.length);
    }
    return item.text;
  });
}

/** One body line of a unified hunk or a V4A chunk. */
interface BodyLine {
  kind: 'ctx' | 'old' | 'new' | 'backslash';
  text: string;
  rawEmpty: boolean;
}

function bodyLine(line: string): BodyLine | null {
  if (line === '') return { kind: 'ctx', text: '', rawEmpty: true };
  const c = line[0]!;
  if (c === ' ') return { kind: 'ctx', text: line.slice(1), rawEmpty: false };
  if (c === '-') return { kind: 'old', text: line.slice(1), rawEmpty: false };
  if (c === '+') return { kind: 'new', text: line.slice(1), rawEmpty: false };
  if (c === '\\') return { kind: 'backslash', text: line.slice(1), rawEmpty: false };
  return null;
}

function stripTrailingEmptyBody(body: BodyLine[]): void {
  while (body.length > 0) {
    const last = body[body.length - 1]!;
    if (last.kind === 'ctx' && last.rawEmpty) body.pop();
    else break;
  }
}

/* ---------------- unified diffs (SPEC.md section 6) ---------------- */

interface UnifiedHunk {
  a: number;
  body: BodyLine[];
}

interface UnifiedSection {
  line: number;
  oldPath: string | null;
  newPath: string | null;
  newFileMode: boolean;
  deletedFileMode: boolean;
  hunks: UnifiedHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: |$)/;

function parseDiffGit(line: string): { old: string; new: string } | null {
  const parts = line.trimEnd().split(' ');
  if (parts.length !== 4 || parts[0] !== 'diff' || parts[1] !== '--git') return null;
  if (!parts[2]!.startsWith('a/') || !parts[3]!.startsWith('b/')) return null;
  return { old: parts[2]!.slice(2), new: parts[3]!.slice(2) };
}

function headerPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

function parseUnified(lines: string[]): UnifiedSection[] {
  const sections: UnifiedSection[] = [];
  let section: UnifiedSection | null = null;
  let inHeader = false;
  let hunk: UnifiedHunk | null = null;
  let dashOld: string | null | undefined;
  let dashNew: string | null | undefined;
  let renameOld: string | undefined;
  let renameNew: string | undefined;
  let gitOld = '';
  let gitNew = '';

  const endHunk = (): void => {
    if (hunk !== null && section !== null) {
      stripTrailingEmptyBody(hunk.body);
      section.hunks.push(hunk);
    }
    hunk = null;
  };
  const endSection = (): void => {
    endHunk();
    if (section !== null) {
      if (dashOld !== undefined) section.oldPath = dashOld;
      else if (renameOld !== undefined) section.oldPath = renameOld;
      else section.oldPath = gitOld;
      if (dashNew !== undefined) section.newPath = dashNew;
      else if (renameNew !== undefined) section.newPath = renameNew;
      else section.newPath = gitNew;
      sections.push(section);
    }
    section = null;
    inHeader = false;
    dashOld = undefined;
    dashNew = undefined;
    renameOld = undefined;
    renameNew = undefined;
    gitOld = '';
    gitNew = '';
  };
  const startSection = (lineNo: number, gOld: string, gNew: string): void => {
    endSection();
    section = { line: lineNo, oldPath: null, newPath: null, newFileMode: false, deletedFileMode: false, hunks: [] };
    inHeader = true;
    gitOld = gOld;
    gitNew = gNew;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const next = i + 1 < lines.length ? lines[i + 1]! : null;
    if (hunk !== null) {
      if (line.startsWith('diff --git ')) {
        endHunk();
        const g = parseDiffGit(line);
        if (g === null) throw new Exit2(`error: parse ${i + 1}`);
        startSection(i + 1, g.old, g.new);
        i++;
        continue;
      }
      if (line.startsWith('--- ') && next !== null && next.startsWith('+++ ')) {
        endHunk();
        endSection();
        startSection(i + 1, '', '');
        // fall through: the --- line is the new section's header
      } else {
        const b = bodyLine(line);
        if (b !== null) {
          hunk.body.push(b);
          i++;
          continue;
        }
        endHunk();
        // fall through: @@ starts a new hunk, anything else is prose
      }
    }
    if (line.startsWith('diff --git ')) {
      const g = parseDiffGit(line);
      if (g === null) throw new Exit2(`error: parse ${i + 1}`);
      startSection(i + 1, g.old, g.new);
      i++;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      if (section === null) throw new Exit2(`error: parse ${i + 1}`);
      inHeader = false;
      hunk = { a: parseInt(m[1]!, 10), body: [] };
      i++;
      continue;
    }
    if (section !== null && inHeader) {
      if (line.startsWith('--- ')) {
        if (next === null || !next.startsWith('+++ ')) throw new Exit2(`error: parse ${i + 2}`);
        dashOld = headerPath(line);
        i++;
        continue;
      }
      if (line.startsWith('+++ ')) {
        dashNew = headerPath(line);
        i++;
        continue;
      }
      if (line.startsWith('rename from ')) {
        renameOld = line.slice(12).trim();
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        renameNew = line.slice(10).trim();
        i++;
        continue;
      }
      if (line.startsWith('new file mode')) {
        section.newFileMode = true;
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        section.deletedFileMode = true;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (line.startsWith('--- ') && next !== null && next.startsWith('+++ ')) {
      startSection(i + 1, '', '');
      continue;
    }
    i++;
  }
  endSection();
  return sections;
}

function unifiedHunkON(h: UnifiedHunk): { o: string[]; n: NLine[] } {
  const o: string[] = [];
  const n: NLine[] = [];
  for (const b of h.body) {
    if (b.kind === 'ctx') {
      o.push(b.text);
      n.push({ text: b.text, isContext: true, oIdx: o.length - 1 });
    } else if (b.kind === 'old') o.push(b.text);
    else if (b.kind === 'new') n.push({ text: b.text, isContext: false, oIdx: -1 });
  }
  return { o, n };
}

/** Is a `\` line immediately after the hunk's last context or `+` line? */
function lastNBackslash(h: UnifiedHunk): boolean {
  let lastN = -1;
  for (let j = 0; j < h.body.length; j++) {
    if (h.body[j]!.kind === 'ctx' || h.body[j]!.kind === 'new') lastN = j;
  }
  if (lastN < 0) return false;
  return h.body[lastN + 1]?.kind === 'backslash';
}

function applyUnifiedHunk(f: FileState, h: UnifiedHunk, on: { o: string[]; n: NLine[] }, a: number, d: number, strict: boolean, path: string): FileState {
  const noNl = lastNBackslash(h);
  if (on.o.length === 0) {
    const ins = Math.max(0, Math.min(a + d, f.lines.length));
    const lines = [...f.lines.slice(0, ins), ...on.n.map((x) => x.text), ...f.lines.slice(ins)];
    let finalBreak = f.finalBreak;
    if (ins === f.lines.length) finalBreak = !noNl;
    return { lines, br: f.br, finalBreak };
  }
  const m = matchTier(f.lines, on.o, strict, 0);
  if (m === null) throw new Fail('no-match', path);
  const target = a - 1 + d;
  let best = m.pos[0]!;
  for (const p of m.pos) {
    if (Math.abs(p - target) < Math.abs(best - target)) best = p;
  }
  const repl = buildReplacement(f.lines, best, on.o, on.n, m.tier);
  const lines = [...f.lines.slice(0, best), ...repl, ...f.lines.slice(best + on.o.length)];
  let finalBreak = f.finalBreak;
  if (best + on.o.length === f.lines.length) finalBreak = !noNl;
  return { lines, br: f.br, finalBreak };
}

function unifiedEdit(section: UnifiedSection, strict: boolean): Edit {
  return (t) => {
    const oldP = section.oldPath;
    const newP = section.newPath;
    if (oldP === null || section.newFileMode) {
      if (newP === null) throw new Fail('unsafe', '');
      if (!safe(newP)) throw new Fail('unsafe', newP);
      if (t.get(newP) !== null) throw new Fail('exists', newP);
      const plus: string[] = [];
      let noNl = false;
      for (const h of section.hunks) {
        for (let j = 0; j < h.body.length; j++) {
          const b = h.body[j]!;
          if (b.kind === 'new') {
            plus.push(b.text);
            noNl = h.body[j + 1]?.kind === 'backslash';
          }
        }
      }
      t.now.set(newP, plus.length === 0 ? '' : plus.join('\n') + (noNl ? '' : '\n'));
      return;
    }
    if (newP === null || section.deletedFileMode) {
      if (!safe(oldP)) throw new Fail('unsafe', oldP);
      if (t.get(oldP) === null) throw new Fail('missing', oldP);
      t.now.set(oldP, null);
      return;
    }
    if (oldP !== newP) {
      if (!safe(oldP)) throw new Fail('unsafe', oldP);
      if (!safe(newP)) throw new Fail('unsafe', newP);
      const cur = t.get(oldP);
      if (cur === null) throw new Fail('missing', oldP);
      if (t.get(newP) !== null) throw new Fail('exists', newP);
      let f = parseFile(cur);
      let d = 0;
      for (const h of section.hunks) {
        const on = unifiedHunkON(h);
        f = applyUnifiedHunk(f, h, on, h.a, d, strict, oldP);
        d += on.n.length - on.o.length;
      }
      t.now.set(newP, renderFile(f));
      t.now.set(oldP, null);
      t.moves.push({ old: oldP, new: newP });
      return;
    }
    if (!safe(oldP)) throw new Fail('unsafe', oldP);
    const cur = t.get(oldP);
    if (cur === null) throw new Fail('missing', oldP);
    let f = parseFile(cur);
    let d = 0;
    for (const h of section.hunks) {
      const on = unifiedHunkON(h);
      f = applyUnifiedHunk(f, h, on, h.a, d, strict, oldP);
      d += on.n.length - on.o.length;
    }
    t.now.set(oldP, renderFile(f));
  };
}

/* ---------------- SEARCH/REPLACE blocks (SPEC.md section 7) ---------------- */

interface SRBlock {
  searchLine: number;
  path: string;
  oldLines: string[];
  newLines: string[];
}

function parseSR(lines: string[]): SRBlock[] {
  const blocks: SRBlock[] = [];
  let prevReplaceEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() === '<<<<<<< SEARCH') {
      const searchLine = i + 1;
      let path: string | null = null;
      for (let j = i - 1; j > prevReplaceEnd; j--) {
        const t = lines[j]!.trim();
        if (t === '' || t.startsWith('```')) continue;
        path = t;
        break;
      }
      if (path === null) {
        if (prevPath === null) throw new Exit2(`error: parse ${searchLine}`);
        path = prevPath;
      }
      let eq = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.trimEnd() === '=======') {
          eq = j;
          break;
        }
      }
      if (eq === -1) throw new Exit2(`error: parse ${searchLine}`);
      let rep = -1;
      for (let j = eq + 1; j < lines.length; j++) {
        if (lines[j]!.trimEnd() === '>>>>>>> REPLACE') {
          rep = j;
          break;
        }
      }
      if (rep === -1) throw new Exit2(`error: parse ${searchLine}`);
      blocks.push({ searchLine, path, oldLines: lines.slice(i + 1, eq), newLines: lines.slice(eq + 1, rep) });
      prevPath = path;
      prevReplaceEnd = rep;
      i = rep + 1;
    } else {
      i++;
    }
  }
  return blocks;
}

function srEdit(block: SRBlock, strict: boolean): Edit {
  return (t) => {
    const p = block.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (block.oldLines.length === 0) {
      if (t.get(p) !== null) throw new Fail('exists', p);
      t.now.set(p, block.newLines.length === 0 ? '' : block.newLines.join('\n') + '\n');
      return;
    }
    const cur = t.get(p);
    if (cur === null) throw new Fail('missing', p);
    const f = parseFile(cur);
    const m = matchTier(f.lines, block.oldLines, strict, 0);
    if (m === null) throw new Fail('no-match', p);
    if (m.pos.length > 1) throw new Fail('ambiguous', p);
    const pos = m.pos[0]!;
    const n: NLine[] = block.newLines.map((text) => ({ text, isContext: false, oIdx: -1 }));
    const repl = buildReplacement(f.lines, pos, block.oldLines, n, m.tier);
    const lines = [...f.lines.slice(0, pos), ...repl, ...f.lines.slice(pos + block.oldLines.length)];
    t.now.set(p, renderFile({ lines, br: f.br, finalBreak: f.finalBreak }));
  };
}

/* ---------------- V4A patches (SPEC.md section 8) ---------------- */

interface V4AChunk {
  anchor: string | null;
  eof: boolean;
  body: BodyLine[];
}

interface V4ASection {
  kind: 'add' | 'delete' | 'update';
  line: number;
  path: string;
  moveTo: string | null;
  addLines: string[];
  chunks: V4AChunk[];
}

function parseV4A(lines: string[]): V4ASection[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!blank(lines[i]!)) {
      last = i;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: V4ASection[] = [];
  let cur: V4ASection | null = null;
  let chunk: V4AChunk | null = null;
  const endChunk = (): void => {
    if (chunk !== null && cur !== null && cur.kind === 'update') cur.chunks.push(chunk);
    chunk = null;
  };
  const endSection = (): void => {
    endChunk();
    if (cur !== null) {
      if (cur.kind === 'add') {
        while (cur.addLines.length > 0 && cur.addLines[cur.addLines.length - 1] === '') cur.addLines.pop();
      } else if (cur.kind === 'update' && cur.chunks.length > 0) {
        stripTrailingEmptyBody(cur.chunks[cur.chunks.length - 1]!.body);
      }
      sections.push(cur);
    }
    cur = null;
  };
  for (let i = first + 1; i < last; i++) {
    const line = lines[i]!;
    if (blank(line)) {
      if (cur !== null && cur.kind === 'add') cur.addLines.push('');
      else if (cur !== null && cur.kind === 'update') {
        if (chunk === null) chunk = { anchor: null, eof: false, body: [] };
        chunk.body.push({ kind: 'ctx', text: '', rawEmpty: true });
      }
      continue;
    }
    if (line.trim() === '*** End Patch') throw new Exit2(`error: parse ${i + 1}`);
    if (line.startsWith('*** Add File:')) {
      endSection();
      cur = { kind: 'add', line: i + 1, path: line.slice(13).trim(), moveTo: null, addLines: [], chunks: [] };
      continue;
    }
    if (line.startsWith('*** Delete File:')) {
      endSection();
      cur = { kind: 'delete', line: i + 1, path: line.slice(16).trim(), moveTo: null, addLines: [], chunks: [] };
      continue;
    }
    if (line.startsWith('*** Update File:')) {
      endSection();
      cur = { kind: 'update', line: i + 1, path: line.slice(16).trim(), moveTo: null, addLines: [], chunks: [] };
      continue;
    }
    if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
    if (cur.kind === 'add') {
      if (line.startsWith('+')) cur.addLines.push(line.slice(1));
      else throw new Exit2(`error: parse ${i + 1}`);
      continue;
    }
    if (cur.kind === 'delete') throw new Exit2(`error: parse ${i + 1}`);
    if (line.startsWith('*** Move to:')) {
      if (chunk !== null || cur.chunks.length > 0 || cur.moveTo !== null) throw new Exit2(`error: parse ${i + 1}`);
      cur.moveTo = line.slice(12).trim();
      continue;
    }
    if (line === '*** End of File') {
      if (chunk === null) throw new Exit2(`error: parse ${i + 1}`);
      chunk.eof = true;
      endChunk();
      continue;
    }
    if (line.startsWith('@@')) {
      endChunk();
      const anchor = line.slice(2).trim();
      chunk = { anchor: anchor === '' ? null : anchor, eof: false, body: [] };
      continue;
    }
    const b = bodyLine(line);
    if (b !== null && (b.kind === 'ctx' || b.kind === 'old' || b.kind === 'new')) {
      if (chunk === null) chunk = { anchor: null, eof: false, body: [] };
      chunk.body.push(b);
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  endSection();
  for (const s of sections) {
    if (s.kind === 'update' && s.chunks.length === 0 && s.moveTo === null) throw new Exit2(`error: parse ${s.line}`);
  }
  return sections;
}

/** First line at or after `from` equal to a single line, at the first tier with one. */
function matchTierSingle(lines: string[], anchor: string, strict: boolean, from: number): number | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    for (let i = from; i < lines.length; i++) {
      if (tierEq(lines[i]!, anchor, t)) return i;
    }
  }
  return null;
}

function applyV4AChunk(f: FileState, chunk: V4AChunk, cursor: number, strict: boolean, path: string): { file: FileState; cursor: number } {
  const o: string[] = [];
  const n: NLine[] = [];
  for (const b of chunk.body) {
    if (b.kind === 'ctx') {
      o.push(b.text);
      n.push({ text: b.text, isContext: true, oIdx: o.length - 1 });
    } else if (b.kind === 'old') o.push(b.text);
    else if (b.kind === 'new') n.push({ text: b.text, isContext: false, oIdx: -1 });
  }
  if (o.length === 0) {
    const ins = chunk.eof ? f.lines.length : cursor;
    const lines = [...f.lines.slice(0, ins), ...n.map((x) => x.text), ...f.lines.slice(ins)];
    return { file: { lines, br: f.br, finalBreak: f.finalBreak }, cursor: ins + n.length };
  }
  const m = matchTier(f.lines, o, strict, cursor);
  if (m === null) throw new Fail('no-match', path);
  let pos: number | null = null;
  for (const p of m.pos) {
    if (chunk.eof && p + o.length !== f.lines.length) continue;
    pos = p;
    break;
  }
  if (pos === null) throw new Fail('no-match', path);
  const repl = buildReplacement(f.lines, pos, o, n, m.tier);
  const lines = [...f.lines.slice(0, pos), ...repl, ...f.lines.slice(pos + o.length)];
  return { file: { lines, br: f.br, finalBreak: f.finalBreak }, cursor: pos + repl.length };
}

function v4aEdit(section: V4ASection, strict: boolean): Edit {
  return (t) => {
    const p = section.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (section.kind === 'add') {
      if (t.get(p) !== null) throw new Fail('exists', p);
      t.now.set(p, section.addLines.length === 0 ? '' : section.addLines.join('\n') + '\n');
      return;
    }
    if (section.kind === 'delete') {
      if (t.get(p) === null) throw new Fail('missing', p);
      t.now.set(p, null);
      return;
    }
    const newP = section.moveTo;
    if (newP !== null && !safe(newP)) throw new Fail('unsafe', newP);
    const cur = t.get(p);
    if (cur === null) throw new Fail('missing', p);
    if (newP !== null && t.get(newP) !== null) throw new Fail('exists', newP);
    let f = parseFile(cur);
    let cursor = 0;
    for (const chunk of section.chunks) {
      if (chunk.anchor !== null) {
        const at = matchTierSingle(f.lines, chunk.anchor, strict, cursor);
        if (at === null) throw new Fail('no-match', p);
        cursor = at + 1;
      }
      const r = applyV4AChunk(f, chunk, cursor, strict, p);
      f = r.file;
      cursor = r.cursor;
    }
    const text = renderFile(f);
    if (newP !== null) {
      t.now.set(newP, text);
      t.now.set(p, null);
      t.moves.push({ old: p, new: newP });
    } else {
      t.now.set(p, text);
    }
  };
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines).map((s) => unifiedEdit(s, strict));
    else if (kind === 'search-replace') edits = parseSR(lines).map((b) => srEdit(b, strict));
    else edits = parseV4A(lines).map((s) => v4aEdit(s, strict));
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: { sort: string; line: string }[] = [];
  const consumed = new Set<string>();
  for (const mv of tree.moves) {
    const wasOld = tree.original(mv.old);
    const wasNew = tree.original(mv.new);
    const nowOld = tree.now.has(mv.old) ? tree.now.get(mv.old)! : tree.original(mv.old);
    const nowNew = tree.now.has(mv.new) ? tree.now.get(mv.new)! : tree.original(mv.new);
    if (wasOld !== null && nowOld === null && wasNew === null && nowNew !== null) {
      rows.push({ sort: mv.new, line: `R ${mv.old} -> ${mv.new}` });
      consumed.add(mv.old);
      consumed.add(mv.new);
    }
  }
  for (const p of [...tree.now.keys()]) {
    if (consumed.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push({ sort: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)));
  const out = rows.map((r) => r.line);
  if (!check) {
    for (const p of [...tree.now.keys()]) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...out, `ok: ${out.length} ${out.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
