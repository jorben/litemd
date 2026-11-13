// 页面侧的内容同步（技术方案第 5 节）。
//   - 只有用户编辑才计数、推送（5.1）；
//   - 从「已同步」变成「有未推送编辑」时立即 markDirty(seq)，防抖后 setContent(seq, text)（5.2）；
//   - 收到 Go 的收齐请求 n：有未推送的编辑就立即推送，再 flushed(n)（5.3）；
//   - 失焦、visibilitychange、切换模式时立即推送。
// 与 mygo 生成的客户端解耦，便于单元测试。

export interface SyncClient {
  markDirty(seq: number): Promise<unknown>;
  setContent(seq: number, text: string): Promise<unknown>;
  flushed(n: number): Promise<unknown>;
}

export interface PageSyncOptions {
  client: SyncClient;
  /** 取当前正文（源码模式直接取编辑器文本；所见即所得经保真写回层序列化） */
  getText: () => string;
  /** 防抖时长；默认按文档大小：< 200 KB 150 ms，否则 400 ms */
  delay?: (size: number) => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export class PageSync {
  /** 每次用户编辑加一 */
  editSeq = 0;
  /** 最后一次推送的序号 */
  pushedSeq = 0;
  /** 暂停推送（冲突提示条显示期间，5.4） */
  paused = false;
  private timer: unknown = null;
  private readonly o: Required<PageSyncOptions>;

  constructor(opts: PageSyncOptions) {
    this.o = {
      delay: (size) => (size < 200_000 ? 150 : 400),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      ...opts,
    };
  }

  /** 从序号 seq 重新开始（载入、重新载入内容之后）。 */
  reset(seq: number): void {
    this.cancel();
    this.editSeq = seq;
    this.pushedSeq = seq;
    this.paused = false;
  }

  get hasUnpushed(): boolean {
    return this.editSeq > this.pushedSeq;
  }

  /** 用户做了一次改变文档的编辑。 */
  edit(): void {
    const wasSynced = !this.hasUnpushed;
    this.editSeq++;
    if (wasSynced) void this.o.client.markDirty(this.editSeq);
    this.schedule();
  }

  private schedule(): void {
    if (this.paused) return;
    this.cancel();
    this.timer = this.o.setTimer(() => {
      this.timer = null;
      void this.push();
    }, this.o.delay(this.o.getText().length));
  }

  private cancel(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
  }

  /** 立即推送未同步的编辑。 */
  async push(): Promise<void> {
    this.cancel();
    if (this.paused || !this.hasUnpushed) return;
    const seq = this.editSeq;
    const text = this.o.getText();
    this.pushedSeq = seq;
    await this.o.client.setContent(seq, text);
  }

  /** 回应 Go 的收齐请求。 */
  async flush(n: number): Promise<void> {
    await this.push();
    await this.o.client.flushed(n);
  }
}
