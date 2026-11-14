// jsdom 没有布局：Range / Element 缺少 getClientRects、getBoundingClientRect。ProseMirror 在 focus()
// 之后异步调用 scrollToSelection → coordsAtPos 会用到它们；测试结束后才触发时成为未处理错误，
// 使 vitest 以非零码退出。这里补上返回空矩形的实现（只在 jsdom 环境下）。
if (typeof window !== "undefined" && typeof Range !== "undefined") {
  const empty = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }) as DOMRect;
  const list = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Element.prototype] as Array<{ getClientRects?: unknown; getBoundingClientRect?: unknown }>) {
    if (typeof proto.getClientRects !== "function") proto.getClientRects = list;
    if (typeof proto.getBoundingClientRect !== "function") proto.getBoundingClientRect = empty;
  }
}
