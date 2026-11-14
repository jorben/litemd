// 保真写回层（技术方案第 6 节，D3）。
//
// 载入时为每个 ProseMirror 顶层块记下它在原文中的区间（单元）；保存时：
//   1. 当前文档与基线结构相同 → 直接返回原文；
//   2. 否则用前后公共子节点找出改动的顶层块范围，范围之外的单元原样输出原文切片，
//      范围之内的块交给 vmark 的规范序列化；
//   3. 把「改动范围 + 前后各一个单元」重新解析，与同一组节点的规范序列化结果比较结构，
//      不一致时依次退回：扩大一个单元 → 整篇规范序列化（mode = "full"，页面提示 F2.5⑤）。
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Root } from "mdast";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { parseMarkdownToMdast } from "@/utils/markdownPipeline/parser";
import { mdastToProseMirrorWithSources } from "@/utils/markdownPipeline/mdastToProseMirror";
import { docFingerprint } from "@/utils/markdownPipeline/__tests__/fidelity/docFingerprint";

/** 一个或几个连续顶层块，对应原文中的一段。 */
export interface Unit {
  /** 第一个顶层节点在 doc 中的下标 */
  first: number;
  /** 顶层节点个数（mdast 与 PM 不一一对应、或拿不到位置时会把多个节点并成一个单元） */
  count: number;
  /** 原文中块文本的起止 [from, end) */
  from: number;
  end: number;
  /** 块之后、下一单元之前的空白（含最后一个单元的末尾换行） */
  sep: string;
}

export interface Baseline {
  source: string;
  doc: PMNode;
  /** 第一个单元之前的空白 */
  lead: string;
  units: Unit[];
  /** 预处理改变了行结构、无法定位块时为 true：整篇当作一个单元 */
  coarse: boolean;
}

export type WriteMode = "unchanged" | "local" | "expanded" | "full";

export interface WriteResult {
  text: string;
  mode: WriteMode;
  /** 规范序列化的单元下标范围 [from, to)（基线中的下标）；full 时为全部。from === to 表示在其前插入 */
  units: [number, number];
  /** 规范序列化的节点在当前文档中的范围 [from, to)（local / expanded 时有） */
  nodes?: [number, number];
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) out.push(i + 1);
  return out;
}

function wholeDocUnit(source: string, doc: PMNode): Pick<Baseline, "lead" | "units"> {
  const end = source.replace(/\s+$/, "").length;
  return { lead: "", units: [{ first: 0, count: doc.childCount, from: 0, end, sep: source.slice(end) }] };
}

/** 解析原文并建立基线（技术方案 6.2 节）。 */
export function loadBaseline(schema: Schema, source: string): Baseline {
  const mdast = parseMarkdownToMdast(source) as Root;
  const { doc, sources } = mdastToProseMirrorWithSources(schema, mdast);
  const starts = lineStarts(source);
  const lineEnd = (line: number) => (line < starts.length ? starts[line]! - 1 : source.length); // 第 line 行（1 起）的行尾
  // 预处理（数学定界符、裸列表标记）可能增删行，此时行号对不上原文，退回粗粒度
  if (mdast.position?.end.line !== starts.length) {
    return { source, doc, coarse: true, ...wholeDocUnit(source, doc) };
  }
  const units: Unit[] = [];
  let next = 0;
  let pendingFirst = -1; // 开头那些拿不到位置的节点，并入下一个单元
  let lastEndLine = 0;
  for (const { child, nodes } of sources) {
    if (nodes.length === 0) continue;
    const s = child.position?.start.line;
    const e = child.position?.end.line;
    const prev = units[units.length - 1];
    if (!Number.isInteger(s) || !Number.isInteger(e) || (s as number) <= lastEndLine) {
      // 没有位置或与前一单元重叠：与前一个单元合并
      if (prev) {
        prev.count += nodes.length;
        if (Number.isInteger(e) && (e as number) > lastEndLine) {
          prev.end = lineEnd(e as number);
          lastEndLine = e as number;
        }
      } else if (pendingFirst < 0) pendingFirst = next;
      next += nodes.length;
      continue;
    }
    const first = pendingFirst >= 0 ? pendingFirst : next;
    units.push({ first, count: next + nodes.length - first, from: starts[(s as number) - 1]!, end: lineEnd(e as number), sep: "" });
    pendingFirst = -1;
    next += nodes.length;
    lastEndLine = e as number;
  }
  if (units.length === 0 || next !== doc.childCount || pendingFirst >= 0) {
    return { source, doc, coarse: true, ...wholeDocUnit(source, doc) };
  }
  units.forEach((u, i) => {
    u.sep = source.slice(u.end, i + 1 < units.length ? units[i + 1]!.from : source.length);
  });
  return { source, doc, coarse: false, lead: source.slice(0, units[0]!.from), units };
}

function canonical(schema: Schema, nodes: PMNode[]): string {
  if (nodes.length === 0) return "";
  return serializeMarkdown(schema, schema.topNodeType.create(null, nodes)).replace(/^\n+|\n+$/g, "");
}

function fingerprintOf(schema: Schema, md: string): string {
  return docFingerprint(parseMarkdown(schema, md));
}

function childrenOf(doc: PMNode, from: number, to: number): PMNode[] {
  const out: PMNode[] = [];
  for (let i = from; i < to; i++) out.push(doc.child(i));
  return out;
}

/**
 * 用规范序列化重写单元 [ua, ub)，其余单元输出原文。cur 中对应的节点范围由公共前后缀推出。
 * insertAfter：没有单元被改动、只是在单元之间插入了节点时，插入点之前的单元下标（-1 表示开头）。
 */
function assemble(
  schema: Schema,
  base: Baseline,
  doc: PMNode,
  ua: number,
  ub: number,
  curFrom: number,
  curTo: number,
  insertAfter: number | null,
): string {
  const { units } = base;
  const middle = canonical(schema, childrenOf(doc, curFrom, curTo));
  let out = base.lead;
  if (insertAfter !== null) {
    // 在第 insertAfter 个单元之后插入（-1 表示文档开头）：新块与前一块之间用一个空行，
    // 前一块原来的分隔挪到新块之后，其余单元原样输出
    if (insertAfter === -1) out += middle + "\n\n";
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      out += base.source.slice(u.from, u.end);
      out += i === insertAfter ? "\n\n" + middle + u.sep : u.sep;
    }
    return out;
  }
  for (let i = 0; i < ua; i++) out += base.source.slice(units[i]!.from, units[i]!.end) + units[i]!.sep;
  if (middle) out += middle + units[ub - 1]!.sep;
  for (let i = ub; i < units.length; i++) out += base.source.slice(units[i]!.from, units[i]!.end) + units[i]!.sep;
  if (!middle && ub === units.length && ua > 0) {
    // 删掉了结尾的块：保证文件仍以最后一个保留单元自己的分隔结尾
    out = out.replace(/\s*$/, "") + units[ub - 1]!.sep.replace(/^[^\n]*\n?/, "\n");
  }
  return out;
}

/** 序列化当前文档（技术方案 6.3 节）。 */
export function serializeWithBaseline(schema: Schema, base: Baseline, doc: PMNode): WriteResult {
  const nb = base.doc.childCount;
  const nc = doc.childCount;
  if (doc === base.doc || doc.eq(base.doc)) return { text: base.source, mode: "unchanged", units: [0, 0] };

  // 0. 原文没有任何块（空白文档、新建文档）：没有可保留的原文，直接规范序列化，以一个换行结尾
  if (nb === 0) {
    const body = canonical(schema, childrenOf(doc, 0, nc));
    return { text: body ? body + "\n" : "", mode: "local", units: [0, 0] };
  }

  // 1. 公共前后缀（未改动的节点通常是同一对象，eq 先比较引用，耗时与改动量成正比）
  const min = Math.min(nb, nc);
  let p = 0;
  while (p < min && doc.child(p).eq(base.doc.child(p))) p++;
  let s = 0;
  while (s < min - p && doc.child(nc - 1 - s).eq(base.doc.child(nb - 1 - s))) s++;

  const { units } = base;
  const unitOf = (node: number) => units.findIndex((u) => node >= u.first && node < u.first + u.count);

  let ua: number;
  let ub: number;
  if (p === nb - s) {
    // 只插入了节点，基线里没有节点被改动
    const boundary = units.findIndex((u) => u.first === p);
    if (boundary >= 0 || p === nb) {
      const after = boundary >= 0 ? boundary - 1 : units.length - 1;
      const text = assemble(schema, base, doc, 0, 0, p, nc - s, after);
      if (verify(schema, base, doc, text, after + 1, after + 1, p, nc - s))
        return { text, mode: "local", units: [after + 1, after + 1], nodes: [p, nc - s] };
      ua = Math.max(0, after);
      ub = Math.min(units.length, after + 2);
    } else {
      ua = unitOf(p);
      ub = ua + 1;
    }
  } else {
    ua = unitOf(p);
    ub = unitOf(nb - s - 1) + 1;
  }

  // 2–5. 局部规范序列化 + 校验；不通过就扩大一个单元，再不行就整篇
  for (const [grow, mode] of [[0, "local"], [1, "expanded"]] as const) {
    const a = Math.max(0, ua - grow);
    const b = Math.min(units.length, ub + grow);
    const baseFrom = units[a]!.first;
    const baseTo = units[b - 1]!.first + units[b - 1]!.count;
    const curFrom = baseFrom;
    const curTo = nc - (nb - baseTo);
    if (curTo < curFrom) continue;
    const text = assemble(schema, base, doc, a, b, curFrom, curTo, null);
    if (verify(schema, base, doc, text, a, b, curFrom, curTo)) return { text, mode, units: [a, b], nodes: [curFrom, curTo] };
  }
  return { text: serializeMarkdown(schema, doc), mode: "full", units: [0, units.length] };
}

/**
 * 局部校验（6.3 节第 5 步）：取改动单元加前后各一个单元，比较「拼出的文本」与
 * 「这些节点全部规范序列化」重新解析后的结构。
 */
function verify(
  schema: Schema,
  base: Baseline,
  doc: PMNode,
  text: string,
  ua: number,
  ub: number,
  curFrom: number,
  curTo: number,
): boolean {
  const { units } = base;
  const nb = base.doc.childCount;
  const nc = doc.childCount;
  const pa = Math.max(0, ua - 1);
  const pb = Math.min(units.length, ub + 1);
  // 在输出中定位这一段：前缀到第 pa 个单元起点不变，后缀从第 pb-1 个单元之后不变
  const head = base.lead.length + units.slice(0, pa).reduce((n, u) => n + (u.end - u.from) + u.sep.length, 0);
  const tailLen =
    pb < units.length ? base.source.length - units[pb]!.from : 0;
  const segment = text.slice(head, text.length - tailLen);
  const segFrom = pa < ua ? units[pa]!.first : curFrom;
  const segToBase = pb > ub ? units[pb - 1]!.first + units[pb - 1]!.count : nb - (nc - curTo);
  const segTo = nc - (nb - segToBase);
  const nodes = childrenOf(doc, segFrom, segTo);
  const got = fingerprintOf(schema, segment);
  // 以当前节点本身为准；保留下来的原文块若本就经不起规范往返（如含行内 HTML 的标题），
  // 拿规范序列化做对照会误判，所以只在节点本身对不上时才用它
  if (got === docFingerprint(schema.topNodeType.create(null, nodes))) return true;
  return got === fingerprintOf(schema, canonical(schema, nodes));
}

/**
 * 推送成功后更新基线（6.3 节第 6 步）：不重新解析——改写的单元并成一个，后面的单元平移偏移与节点下标。
 * 1 MB 文档重新解析约 1 s，每次推送都做会让输入停顿后卡住（NF2）。结果与新文本逐字节核对，
 * 对不上（或少见的边界情况）时退回重新解析。
 */
export function commitBaseline(schema: Schema, base: Baseline, doc: PMNode, res: WriteResult): Baseline {
  if (res.mode === "unchanged") return base;
  const shifted = res.mode === "full" || base.coarse || !res.nodes ? null : shiftUnits(schema, base, doc, res);
  if (shifted) return shifted;
  const next = loadBaseline(schema, res.text);
  if (res.mode === "full" || next.doc.childCount !== doc.childCount) return next;
  return { ...next, doc };
}

function shiftUnits(schema: Schema, base: Baseline, doc: PMNode, res: WriteResult): Baseline | null {
  const { units } = base;
  const [a, b] = res.units;
  const [curFrom, curTo] = res.nodes!;
  const nodeDelta = doc.childCount - base.doc.childCount;
  const middle = canonical(schema, childrenOf(doc, curFrom, curTo));
  const out: Unit[] = units.slice(0, a).map((u) => ({ ...u }));
  let delta: number;
  if (a === b) {
    // 在第 a 个单元之前插入（assemble 的 insertAfter = a - 1）
    if (!middle || curTo <= curFrom) return null;
    let from: number;
    let sep: string;
    if (a === 0) {
      from = base.lead.length;
      sep = "\n\n";
    } else {
      const prev = out[a - 1]!;
      from = prev.end + 2;
      sep = prev.sep;
      prev.sep = "\n\n";
    }
    out.push({ first: curFrom, count: curTo - curFrom, from, end: from + middle.length, sep });
    delta = middle.length + 2;
  } else {
    const start = units[a]!.from;
    const oldNext = b < units.length ? units[b]!.from : base.source.length;
    if (middle) {
      const sep = units[b - 1]!.sep;
      out.push({ first: curFrom, count: curTo - curFrom, from: start, end: start + middle.length, sep });
      delta = start + middle.length + sep.length - oldNext;
    } else {
      if (b === units.length) return null; // 删掉了结尾的块：assemble 会调整末尾空白，交给重新解析
      delta = start - oldNext;
    }
  }
  for (let i = b; i < units.length; i++) {
    const u = units[i]!;
    out.push({ ...u, first: u.first + nodeDelta, from: u.from + delta, end: u.end + delta });
  }
  if (out.length === 0) return null;
  const next: Baseline = { source: res.text, doc, lead: base.lead, units: out, coarse: false };
  // 核对：单元首尾相接正好覆盖新文本，节点数对得上
  let text = next.lead;
  let nodes = 0;
  for (const u of out) {
    if (u.from !== text.length || u.first !== nodes) return null;
    text += res.text.slice(u.from, u.end) + u.sep;
    nodes += u.count;
  }
  return text === res.text && nodes === doc.childCount ? next : null;
}

/** 测试用：直接调用不带退路的平移。 */
export const __testShiftUnits = shiftUnits;
