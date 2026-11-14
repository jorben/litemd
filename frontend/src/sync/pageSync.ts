// 页面侧的内容同步（技术方案第 5 节）。
//   - 只有用户编辑才计数、推送（5.1）；
//   - 从「已同步」变成「有未推送编辑」时立即 markDirty(seq)，防抖后 setContent(seq, text)（5.2）；
//   - 收到 Go 的收齐请求 n：有未推送的编辑就立即推送，再 flushed(n)（5.3）；暂停时只有强制收齐才推送（5.4）；
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
  /** 文档大小的估计，只用来选防抖时长。每次按键都会调用，不能序列化全文（1 MB 文档序列化约 1 s，NF2）；
   *  默认用 getText().length */
  getSize?: () => number;
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
  /**
   * 竞态冲突的暂停尚未结束（5.4）。提示条按钮与 Go 的 conflictResolved 事件都经 release() 结束它，
   * 只有第一个生效，不会重复处理。
   */
  held = false;
  private timer: unknown = null;
  private readonly o: Required<PageSyncOptions>;

  constructor(opts: PageSyncOptions) {
    this.o = {
      delay: (size) => (size < 200_000 ? 150 : 400),
      getSize: () => opts.getText().length,
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
    this.held = false;
  }

  /** 进入竞态冲突的暂停：不再推送，直到 release() 或 reset()。 */
  hold(): void {
    this.paused = true;
    this.held = true;
  }

  /** 结束竞态冲突的暂停、恢复推送（不立即推送）。返回是否确实在暂停中；已结束时什么都不做。 */
  release(): boolean {
    if (!this.held) return false;
    this.held = false;
    this.paused = false;
    return true;
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
    }, this.o.delay(this.o.getSize()));
  }

  private cancel(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
  }

  /** 立即推送未同步的编辑。force：暂停中也推送（用户已在关窗或退出对话框里选了「保留我的版本」）。 */
  async push(force = false): Promise<void> {
    this.cancel();
    if ((this.paused && !force) || !this.hasUnpushed) return;
    const seq = this.editSeq;
    const text = this.o.getText();
    this.pushedSeq = seq;
    await this.o.client.setContent(seq, text);
  }

  /** 回应 Go 的收齐请求。非强制的收齐在暂停中不推送，不会静默覆盖磁盘上的外部修改。 */
  async flush(n: number, force = false): Promise<void> {
    await this.push(force);
    await this.o.client.flushed(n);
  }
}
