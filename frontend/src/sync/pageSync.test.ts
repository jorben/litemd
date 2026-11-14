import { describe, expect, it } from "vitest";
import { PageSync } from "./pageSync";

function setup(text = "a") {
  const calls: string[] = [];
  const timers: Array<() => void> = [];
  let body = text;
  const s = new PageSync({
    client: {
      markDirty: async (seq) => calls.push(`dirty:${seq}`),
      setContent: async (seq, t) => calls.push(`set:${seq}:${t}`),
      flushed: async (n) => calls.push(`flushed:${n}`),
    },
    getText: () => body,
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimer: (t) => {
      timers[t as number] = () => {};
    },
  });
  return { s, calls, fire: () => timers.splice(0).forEach((f) => f()), setText: (t: string) => (body = t) };
}

describe("页面同步协议（技术方案第 5 节）", () => {
  it("只在从「已同步」变为「有未推送编辑」时 markDirty 一次，防抖后推送最新序号", async () => {
    const { s, calls, fire, setText } = setup();
    s.edit();
    s.edit();
    setText("abc");
    s.edit();
    expect(calls).toEqual(["dirty:1"]);
    fire();
    await Promise.resolve();
    expect(calls).toEqual(["dirty:1", "set:3:abc"]);
    expect(s.hasUnpushed).toBe(false);
    s.edit();
    expect(calls.at(-1)).toBe("dirty:4");
  });

  it("没有用户编辑时不推送", async () => {
    const { s, calls, fire } = setup();
    fire();
    await s.push();
    await s.flush(1);
    expect(calls).toEqual(["flushed:1"]);
  });

  it("收齐：先推送未同步的编辑，再应答", async () => {
    const { s, calls, setText } = setup();
    s.edit();
    setText("最新");
    await s.flush(9);
    expect(calls).toEqual(["dirty:1", "set:1:最新", "flushed:9"]);
  });

  it("暂停时（冲突提示条）不推送，reset 后从新序号继续", async () => {
    const { s, calls } = setup();
    s.paused = true;
    s.edit();
    await s.push();
    expect(calls).toEqual(["dirty:1"]);
    s.reset(20);
    s.edit();
    expect(calls.at(-1)).toBe("dirty:21");
  });
});

describe("按键路径（NF2）", () => {
  it("给了 getSize 时，edit() 不序列化全文；只在推送时取一次正文", async () => {
    let gets = 0;
    const timers: Array<() => void> = [];
    const s = new PageSync({
      client: { markDirty: async () => {}, setContent: async () => true, flushed: async () => {} },
      getText: () => (gets++, "x"),
      getSize: () => 1_000_000,
      delay: (n) => (n > 200_000 ? 400 : 150),
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    });
    for (let i = 0; i < 50; i++) s.edit();
    expect(gets).toBe(0);
    await s.push();
    expect(gets).toBe(1);
  });
});
