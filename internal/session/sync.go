// Package session 实现页面与 Go 之间的内容同步协议（技术方案第 5 节）和 Session 绑定服务。
//
// sync.go 是不依赖 mygo 的状态机，便于单元测试：
//   - 页面每次用户编辑 editSeq++；从「已同步」变成「有未推送编辑」时立即 MarkDirty(seq)；
//   - 防抖后 SetContent(seq, text)；绑定调用并发执行、可能乱序，序号旧的直接丢弃；
//   - 保存、关窗、退出前 Go 侧 RequestFlush，页面推送最新内容后 Flushed(n)，超时 800 ms 放行。
package session

import (
	"sync"
	"time"
)

// FlushTimeout 是等待页面收齐的上限（技术方案 5.3 节）。
const FlushTimeout = 800 * time.Millisecond

// Sync 是一个文档窗口的同步状态。方法可在任意 goroutine 调用。
type Sync struct {
	mu         sync.Mutex
	pendingSeq int64 // 页面报告过的最大编辑序号（MarkDirty 或 SetContent）
	lastSeq    int64 // 已应用的最大 SetContent 序号
	givenUp    int64 // 收齐超时时放弃等待的序号：不再认为它需要收齐，避免关窗/退出反复卡住
	nextFlush  int64
	waiters    map[int64]chan struct{}
}

// NewSync 返回初始状态：页面刚载入，没有未推送的编辑。
func NewSync() *Sync { return &Sync{waiters: map[int64]chan struct{}{}} }

// MarkDirty 记录页面出现了序号为 seq 的未推送编辑。返回 true 表示这是新的编辑（调用方据此 SetEdited(true)）。
func (s *Sync) MarkDirty(seq int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq <= s.lastSeq || seq <= s.pendingSeq {
		return false
	}
	s.pendingSeq = seq
	return true
}

// Accept 判断序号为 seq 的推送是否应用；应用时在锁内调用 apply（保证旧内容不会覆盖新内容）。
func (s *Sync) Accept(seq int64, apply func()) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq <= s.lastSeq {
		return false
	}
	s.lastSeq = seq
	if seq > s.pendingSeq {
		s.pendingSeq = seq
	}
	apply()
	return true
}

// Reset 在重新载入内容（外部修改、还原、丢弃恢复）后调用：页面从序号 seq 重新开始。
func (s *Sync) Reset(seq int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seq > s.lastSeq {
		s.lastSeq = seq
	}
	if seq > s.pendingSeq {
		s.pendingSeq = seq
	}
}

// Seq 返回已应用的最新序号（页面重新读取内容时，从这个序号继续）。
func (s *Sync) Seq() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastSeq
}

// NeedsFlush 报告页面是否还有未推送的编辑。
func (s *Sync) NeedsFlush() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pendingSeq > s.lastSeq && s.pendingSeq > s.givenUp
}

// RequestFlush 开始一次收齐：返回请求号 n 和在页面应答（或推送赶上）时关闭的通道。
func (s *Sync) RequestFlush() (int64, <-chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextFlush++
	ch := make(chan struct{})
	s.waiters[s.nextFlush] = ch
	return s.nextFlush, ch
}

// Flushed 是页面对收齐请求 n 的应答。
func (s *Sync) Flushed(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, ch := range s.waiters {
		if k <= n {
			close(ch)
			delete(s.waiters, k)
		}
	}
}

// GiveUp 在收齐超时后调用：以最后一次推送为准，不再等待当前的待推送序号。
func (s *Sync) GiveUp() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.givenUp = s.pendingSeq
}

// Flush 发出收齐请求（emit 负责把请求发给页面）并等待应答，超时则放弃。
// 不需要收齐时立即返回 true；返回 false 表示超时。不可在主线程调用。
func (s *Sync) Flush(emit func(n int64) error, timeout time.Duration) bool {
	if !s.NeedsFlush() {
		return true
	}
	n, done := s.RequestFlush()
	if err := emit(n); err != nil {
		s.GiveUp()
		return false
	}
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		s.GiveUp()
		return false
	}
}
