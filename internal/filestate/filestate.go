// Package filestate 按文件记住查看模式、大纲开关、滚动位置和窗口位置大小（PRD F1.8、F3.7、F7.1；
// 技术方案 3.3、3.7 节）。存在 PathUserData/file-state.json，以文件绝对路径为键（Windows 上不区分
// 大小写），LRU 只保留最近 500 个文件，避免 mygo 默认的 window-state.json 随打开过的文件无限增长。
package filestate

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
	"github.com/jorben/litemd/internal/session"
)

// Limit 是记住的文件数上限。
const Limit = 500

// FileState 是页面保存的按文件状态。
type FileState struct {
	Mode    string  `json:"mode,omitempty"`
	Outline bool    `json:"outline,omitempty"`
	Scroll  float64 `json:"scroll,omitempty"` // 滚动比例 0–1
}

type entry struct {
	Used   int64             `json:"used"` // 最近使用的序号，越大越新
	File   FileState         `json:"file"`
	Window *mygo.WindowState `json:"window,omitempty"`
}

// Store 是按文件状态的存储，实现 mygo.WindowStateStore。
type Store struct {
	mu      sync.Mutex
	path    string
	clock   int64
	entries map[string]*entry
}

// Key 把文件路径规范化为键。
func Key(path string) string {
	p := filepath.Clean(path)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		// macOS 默认文件系统也不区分大小写
		p = strings.ToLower(p)
	}
	return p
}

// WindowKey 是文档窗口的 StateKey；未命名文档为空（不记住）。
func WindowKey(path string) string {
	if path == "" {
		return ""
	}
	return "doc:" + Key(path)
}

// Open 读取 dir/file-state.json。
func Open(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "file-state.json"), entries: map[string]*entry{}}
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &s.entries)
		for _, e := range s.entries {
			if e.Used > s.clock {
				s.clock = e.Used
			}
		}
	}
	return s
}

func (s *Store) touch(key string) *entry {
	s.clock++
	e := s.entries[key]
	if e == nil {
		e = &entry{}
		s.entries[key] = e
	}
	e.Used = s.clock
	s.evict()
	return e
}

// evict 只保留最近使用的 Limit 个文件（调用方持锁）。
func (s *Store) evict() {
	if len(s.entries) <= Limit {
		return
	}
	keys := make([]string, 0, len(s.entries))
	for k := range s.entries {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return s.entries[keys[i]].Used > s.entries[keys[j]].Used })
	for _, k := range keys[Limit:] {
		delete(s.entries, k)
	}
}

func (s *Store) save() error {
	s.mu.Lock()
	b, err := json.Marshal(s.entries)
	path := s.path
	s.mu.Unlock()
	if err != nil || path == "" {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return doc.WriteFileAtomic(path, b)
}

// Get 返回文件的状态。
func (s *Store) Get(path string) (FileState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[Key(path)]
	if !ok {
		return FileState{}, false
	}
	return e.File, true
}

// Set 保存文件的状态。
func (s *Store) Set(path string, fs FileState) error {
	s.mu.Lock()
	s.touch(Key(path)).File = fs
	s.mu.Unlock()
	return s.save()
}

// Len 返回记住的文件数。
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}

// LoadWindowStates 实现 mygo.WindowStateStore。
func (s *Store) LoadWindowStates() (map[string]mygo.WindowState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]mygo.WindowState{}
	for k, e := range s.entries {
		if e.Window != nil {
			out["doc:"+k] = *e.Window
		}
	}
	return out, nil
}

// SaveWindowStates 实现 mygo.WindowStateStore：只更新变化了的窗口状态。
func (s *Store) SaveWindowStates(states map[string]mygo.WindowState) error {
	s.mu.Lock()
	if len(states) == 0 { // App.ClearWindowStates
		for _, e := range s.entries {
			e.Window = nil
		}
	}
	for k, ws := range states {
		key, ok := strings.CutPrefix(k, "doc:")
		if !ok {
			continue
		}
		if e := s.entries[key]; e != nil && e.Window != nil && *e.Window == ws {
			continue
		}
		ws := ws
		s.touch(key).Window = &ws
	}
	s.mu.Unlock()
	return s.save()
}

// Default 是应用的按文件状态存储。
var Default = &Store{entries: map[string]*entry{}}

// Load 打开 PathUserData 下的按文件状态，并接管 mygo 的窗口状态存储。
// restore 为假时（设置中关闭「记住窗口大小和位置」）不接管。
func Load(restore bool) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return
	}
	Default = Open(dir)
	if restore {
		mygo.App.SetWindowStateStore(Default)
	}
}

// Service 是绑定给页面的 FileState 服务。
type Service struct{}

// Get 返回调用者窗口文档的状态（未命名文档没有）。
func (Service) Get(ctx context.Context) (FileState, error) {
	d := session.ForWindow(mygo.CallerWindow(ctx))
	if d == nil {
		return FileState{}, session.ErrNoDocument
	}
	p := d.State().Path
	if p == "" {
		return FileState{}, nil
	}
	fs, _ := Default.Get(p)
	return fs, nil
}

// Set 保存调用者窗口文档的状态。
func (Service) Set(ctx context.Context, fs FileState) error {
	d := session.ForWindow(mygo.CallerWindow(ctx))
	if d == nil {
		return session.ErrNoDocument
	}
	if p := d.State().Path; p != "" {
		return Default.Set(p, fs)
	}
	return nil
}
