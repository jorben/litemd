// Migrated from xiaolai/vmark@01bf9f4 src/utils/markdownPipeline/dialectDescriptors.ts
// Copyright (c) 2026 Xiaolai Li. ISC License (see THIRD_PARTY.md).
/**
 * Purpose: the ONE description of VMark's markdown dialect — which remark
 * plugins each parse mode runs, and why the modes differ.
 *
 * The repo had four independently maintained plugin lists: the editor's
 * conditional chain, the lint chain that loads everything, the `<details>` body
 * parser, and the inline-summary parser. Nothing connected them, so adding a
 * plugin to one silently changed what that mode could parse relative to the
 * others — and the deltas that already existed were implied by call sites
 * rather than stated anywhere.
 *
 * Key decisions:
 *   - MEMBERSHIP IS TOTAL. `PluginDescriptor.modes` is a `Record<ParseMode, …>`,
 *     so adding a plugin without deciding every mode is a COMPILE error, not a
 *     review miss. That is the strongest form of the "fails a gate" criterion:
 *     the gate is the type system, with `dialect.test.ts` checking that the
 *     BUILT processors match what is declared here.
 *   - DESCRIPTORS ARE NOT CONSTRUCTION. `dialect.ts` assembles them. That split
 *     is what lets the `<details>` body parser be INJECTED instead of importing
 *     the chain that registers it — where a cycle would form.
 *   - THE NESTED DIALECT IS DELIBERATELY REDUCED, and always was — an accident
 *     of which imports the file happened to have, now a stated policy with a
 *     reason per plugin. Excluding `remarkDetailsBlock` from it is the
 *     recursion guard, and is the point.
 *   - SERIALIZATION IS OUT OF SCOPE, explicitly. `serializer.ts` builds a
 *     mdast→markdown processor; it shares no attachers with these and answers
 *     a different question. "No processor outside this module" applies to
 *     PARSING only.
 *   - The input domain is `canonicalEditorText` (LF, BOM-free) — decision D3
 *     reserves `rawDiskText` for ingestion, and the two readings of "raw" are
 *     exactly the ambiguity that makes offsets a wrong-range risk.
 *
 * This file is the TABLE. Construction lives in `dialect.ts`, which is the
 * separation the plugin-vs-processor split requires: a descriptor list that
 * also builds is a module every consumer must import to read a policy.
 *
 * @coordinates-with dialect.ts — builds processors from these descriptors
 * @coordinates-with dialect.test.ts — the drift gate
 * @module utils/markdownPipeline/dialectDescriptors
 */
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkBreaks from "remark-breaks";
import {
  remarkCustomInline,
  remarkDetailsBlock,
  remarkResolveReferences,
  remarkTocBlock,
  remarkWikiLinks,
} from "./plugins";
import {
  remarkDisableSetextHeadings,
  remarkValidateMath,
  remarkDepthLimit,
  type ContentAnalysis,
} from "./parser/remarkPlugins";
import { remarkInlineFastPaths } from "./parser/fastPaths/remarkInlineFastPaths";

/**
 * The parse dialects. Each answers a different question, so each runs a
 * different plugin set — stated below rather than inferred.
 */
export const PARSE_MODES = [
  /** Production editor parse: conditional loading, normalisation applied. */
  "document",
  /**
   * Raw-offset parse for lint and any range-authorising consumer: EVERY plugin
   * loaded unconditionally, no preprocessing, so positions map to the source
   * the user is looking at.
   */
  "source-position",
  /** The body of a `<details>` block, re-parsed. Deliberately reduced. */
  "details-body",
  /** A `<summary>`'s inline content. Smallest dialect that still has marks. */
  "inline-summary",
] as const;

export type ParseMode = (typeof PARSE_MODES)[number];

/**
 * What a conditional plugin depends on: the content-analysis flags plus the one
 * build OPTION that changes the stack. `preserveLineBreaks` is a preference,
 * not a property of the text — but it selects a plugin, so leaving it out of
 * this union is how a stack-changing input gets forgotten.
 */
export interface DialectContext extends ContentAnalysis {
  preserveLineBreaks: boolean;
}

export type AnalysisFlag = keyof DialectContext;

/** `"always"` | `{ when: flag }` | `"never"` (deliberately absent; see reason). */
export type Membership = "always" | "never" | { when: AnalysisFlag };

export interface PluginDescriptor {
  /** MUST equal the attacher's function name — the drift gate matches on it. */
  name: string;
  plugin: unknown;
  options?: unknown;
  /** Total over ParseMode: omitting one is a compile error. */
  modes: Record<ParseMode, Membership>;
  /** Why the modes differ. Required — a delta without a reason is drift. */
  reason: string;
}

/**
 * The dialect. Order is significant: processors are built in this order, and
 * remark plugin order affects tokenisation.
 */
export const DIALECT: readonly PluginDescriptor[] = [
  {
    name: "remarkParse",
    plugin: remarkParse,
    modes: {
      document: "always",
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "always",
    },
    reason: "The CommonMark base. Every mode parses markdown.",
  },
  {
    name: "remarkGfm",
    plugin: remarkGfm,
    // litemd: D13 — `~x~` 与 GitHub 一样是删除线（singleTilde 取默认值 true）；
    // vmark 原为 false，把 `~x~` 留给下标。
    options: { singleTilde: true },
    modes: {
      document: "always",
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "always",
    },
    reason:
      "Tables, task lists, strikethrough, autolinks. `singleTilde: true` (litemd) in " +
      "every mode, or `~x~` would become deletion in one dialect and subscript " +
      "in another for the same text.",
  },
  {
    name: "remarkInlineFastPaths",
    plugin: remarkInlineFastPaths,
    modes: { document: "always", "source-position": "always", "details-body": "always", "inline-summary": "always" },
    reason: "Linear-time `]`, backtick and emphasis closers that cannot match (#1407). Tree-identical, " +
      "so every mode. Right after GFM: its emphasis wrapper must sit directly behind micromark's own.",
  },
  {
    name: "remarkDisableSetextHeadings",
    plugin: remarkDisableSetextHeadings,
    modes: {
      document: { when: "hasAmbiguousListUnderline" },
      "source-position": "never",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "Repairs one shape — an indented lone list marker read as a setext " +
      "underline. `source-position` must NOT repair: its job is the offsets of " +
      "the text as written. Nested and inline dialects never carried it.",
  },
  {
    name: "remarkMath",
    plugin: remarkMath,
    modes: {
      document: { when: "hasMath" },
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "never",
    },
    reason:
      "`source-position` loads everything unconditionally so positions never " +
      "depend on content sniffing. A summary is inline-only; block math there " +
      "is not a thing the editor can represent.",
  },
  {
    name: "remarkDepthLimit",
    plugin: remarkDepthLimit,
    modes: {
      document: "always",
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "always",
    },
    reason:
      "Adversarial input nests mdast deep enough to blow the recursive " +
      "mdast→PM converters' call stack (OSS-Fuzz soak, WI-5.1). Beyond " +
      "MAX_MDAST_DEPTH the subtree flattens to plain text — defined " +
      "degradation on garbage, inert on every real document.",
  },
  {
    name: "remarkValidateMath",
    plugin: remarkValidateMath,
    modes: {
      document: { when: "hasMath" },
      "source-position": "always",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "Validation annotates malformed math. The details body has never run it; " +
      "keeping it out preserves the existing nested behaviour rather than " +
      "silently widening the nested dialect during a refactor.",
  },
  {
    name: "remarkFrontmatter",
    plugin: remarkFrontmatter,
    options: ["yaml"],
    modes: {
      document: { when: "hasFrontmatter" },
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "never",
    },
    reason:
      "Only meaningful at offset 0 of its own document. The details body is " +
      "parsed as a standalone document, which is why it carries it.",
  },
  {
    name: "remarkWikiLinks",
    plugin: remarkWikiLinks,
    modes: {
      document: "never",
      "source-position": "never",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "litemd: D13 / F4.11 — `[[...]]` 不是 CommonMark/GFM 语法，LiteMd 按普通文本原样保留。",
  },
  {
    name: "remarkDetailsBlock",
    plugin: remarkDetailsBlock,
    modes: {
      document: { when: "hasDetails" },
      "source-position": "always",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "NEVER in `details-body` — that is the recursion guard. A body parser " +
      "that registered this plugin would need a body parser, without bound. " +
      "Nested `<details>` are handled by the OUTER pass's depth tracking, not " +
      "by re-entering the plugin.",
  },
  {
    name: "remarkTocBlock",
    plugin: remarkTocBlock,
    modes: {
      document: "never",
      "source-position": "never",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "litemd: F4.11 — `[TOC]` 是 vmark 自定义语法，LiteMd 不迁目录扩展（技术方案 4.4 节），按普通文本原样保留。",
  },
  {
    name: "remarkCustomInline",
    plugin: remarkCustomInline,
    modes: {
      document: "never",
      "source-position": "never",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "litemd: D13 — `==高亮==` `~下标~` `^上标^` `++下划线++` 不是 CommonMark/GFM 语法，启用会改变 GitHub 上的显示效果；按普通文本原样保留。",
  },
  {
    name: "remarkResolveReferences",
    plugin: remarkResolveReferences,
    modes: {
      document: "always",
      "source-position": "always",
      "details-body": "always",
      "inline-summary": "never",
    },
    reason:
      "Resolves GFM reference links against definitions in the same document. " +
      "A summary is a fragment with no definitions to resolve against.",
  },
  {
    name: "remarkBreaks",
    plugin: remarkBreaks,
    modes: {
      document: { when: "preserveLineBreaks" },
      "source-position": "never",
      "details-body": "never",
      "inline-summary": "never",
    },
    reason:
      "A rendering preference, not dialect. `source-position` must not add " +
      "break nodes the source does not contain.",
  },
] as const;
