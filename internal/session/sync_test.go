package session

import (
	"errors"
	"math/rand"
	"sync"
	"testing"
	"time"
)

// 乱序到达的推送：序号旧的被丢弃，最终内容是最新一次（技术方案 5.2 节）。
func TestOutOfOrderSetContent(t *testing.T) {
	s := NewSync()
	var content int64
	for _, seq := range []int64{3, 1, 5, 4, 2} {
		s.Accept(seq, func() { content = seq })
	}
	if content != 5 || s.Seq() != 5 {
		t.Fatalf("content=%d seq=%d", content, s.Seq())
	}
}

// 并发推送：任何交错下，最终应用的都是最大序号。
func TestConcurrentSetContent(t *testing.T) {
	for round := 0; round < 50; round++ {
		s := NewSync()
		var mu sync.Mutex
		var content int64
		var wg sync.WaitGroup
		seqs := rand.Perm(200)
		for _, q := range seqs {
			wg.Add(1)
			go func(seq int64) {
				defer wg.Done()
				s.MarkDirty(seq)
				s.Accept(seq, func() { mu.Lock(); content = seq; mu.Unlock() })
			}(int64(q + 1))
		}
		wg.Wait()
		if content != 200 || s.NeedsFlush() {
			t.Fatalf("round %d: content=%d needsFlush=%v", round, content, s.NeedsFlush())
		}
	}
}

func TestMarkDirtyNeedsFlush(t *testing.T) {
	s := NewSync()
	if s.NeedsFlush() {
		t.Fatal("初始不需要收齐")
	}
	if !s.MarkDirty(1) {
		t.Fatal("新编辑应返回 true")
	}
	if s.MarkDirty(1) {
		t.Fatal("同一序号重复报告应返回 false")
	}
	if !s.NeedsFlush() {
		t.Fatal("有未推送编辑时需要收齐")
	}
	s.Accept(1, func() {})
	if s.NeedsFlush() {
		t.Fatal("推送赶上后不需要收齐")
	}
	// markDirty 晚于对应的 setContent 到达（乱序）：不应重新变脏
	if s.MarkDirty(1) || s.NeedsFlush() {
		t.Fatal("迟到的 markDirty 不应让文档重新需要收齐")
	}
}

// 收齐：页面应答前推送最新内容，Flush 返回 true。
func TestFlushAnswered(t *testing.T) {
	s := NewSync()
	s.MarkDirty(7)
	var got int64
	ok := s.Flush(func(n int64) error {
		go func() {
			time.Sleep(10 * time.Millisecond)
			s.Accept(7, func() { got = 7 })
			s.Flushed(n)
		}()
		return nil
	}, time.Second)
	if !ok || got != 7 || s.NeedsFlush() {
		t.Fatalf("ok=%v got=%d", ok, got)
	}
}

// 收齐超时：放行，并且不再认为需要收齐（关窗、退出不会反复卡住）。
func TestFlushTimeout(t *testing.T) {
	s := NewSync()
	s.MarkDirty(3)
	start := time.Now()
	if s.Flush(func(int64) error { return nil }, 50*time.Millisecond) {
		t.Fatal("没有应答应返回 false")
	}
	if time.Since(start) < 50*time.Millisecond {
		t.Fatal("未等到超时")
	}
	if s.NeedsFlush() {
		t.Fatal("超时后不应再需要收齐")
	}
	// 之后的新编辑照常需要收齐
	s.MarkDirty(4)
	if !s.NeedsFlush() {
		t.Fatal("新编辑应需要收齐")
	}
}

func TestFlushEmitError(t *testing.T) {
	s := NewSync()
	s.MarkDirty(1)
	if s.Flush(func(int64) error { return errors.New("window closed") }, time.Second) {
		t.Fatal("emit 失败应返回 false")
	}
	if s.NeedsFlush() {
		t.Fatal("窗口已关闭时不应再等待")
	}
}

func TestFlushNotNeeded(t *testing.T) {
	s := NewSync()
	called := false
	if !s.Flush(func(int64) error { called = true; return nil }, time.Second) || called {
		t.Fatal("不需要收齐时不应发请求")
	}
}

// 重新载入后，旧序号的推送不能覆盖新内容。
func TestReset(t *testing.T) {
	s := NewSync()
	s.Accept(2, func() {})
	s.Reset(10)
	applied := false
	s.Accept(9, func() { applied = true })
	if applied || s.Seq() != 10 {
		t.Fatalf("applied=%v seq=%d", applied, s.Seq())
	}
}
