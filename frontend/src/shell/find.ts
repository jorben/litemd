// 查找替换的状态（PRD F7.2/F7.3，技术方案 8.3 节）。
// 所见即所得 / 预览由迁入的 vmark search 扩展执行（通过 hostSearch 端口读这里的状态），
// 源码 / 分屏由 editor/source.ts 执行；两边都把匹配数和当前位置报告回来。
import { bindHostSearch, type SearchQuery } from "@/plugins/shared/hostSearch";

export type FindState = SearchQuery;

const listeners = new Set<() => void>();
let state: FindState = {
  isOpen: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  currentIndex: -1,
  replaceText: "",
  matchCount: 0,
};

export function findState(): FindState {
  return state;
}

export function setFind(patch: Partial<FindState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function onFind(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 下一处 / 上一处：在已报告的匹配中循环。 */
export function stepFind(dir: 1 | -1): void {
  const { matchCount, currentIndex } = state;
  if (matchCount <= 0) return;
  setFind({ currentIndex: (currentIndex + dir + matchCount) % matchCount });
}

/** 把状态接到 vmark 的 search 扩展。 */
export function bindFindToVmark(): void {
  bindHostSearch({
    current: () => state,
    reportMatches: (count, index) => {
      if (count === state.matchCount && index === state.currentIndex) return;
      state = { ...state, matchCount: count, currentIndex: index };
      listeners.forEach((fn) => fn());
    },
    findNext: () => stepFind(1),
    findPrevious: () => stepFind(-1),
    open: () => setFind({ isOpen: true }),
    onChange: (fn) => onFind(fn),
  });
}

/** 所见即所得中的替换：vmark search 扩展监听这两个窗口事件。 */
export function replaceCurrentInWysiwyg(): void {
  window.dispatchEvent(new CustomEvent("search:replace-current"));
}
export function replaceAllInWysiwyg(): void {
  window.dispatchEvent(new CustomEvent("search:replace-all"));
}
