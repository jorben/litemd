// Package export 提供页面导出文件的入口（PRD F8；技术方案 3.4、7 节）。
//
// 写盘只发生在用户在保存对话框里选的路径：ChoosePath 弹对话框并登记路径，WriteChosen 只接受
// 本窗口最近登记、未过期的路径，写一次后作废。页面无法借此写任意路径（NF5）。
package export

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
)

// ChosenTTL 是登记路径的有效期。
const ChosenTTL = 2 * time.Minute

// ErrNotChosen：路径不是本窗口在保存对话框里选的。
var ErrNotChosen = errors.New("export: 只能写入保存对话框里选择的路径")

type chosen struct {
	path string
	at   time.Time
}

var (
	mu    sync.Mutex
	paths = map[any][]chosen{}
	now   = time.Now
)

func register(w any, p string) {
	mu.Lock()
	defer mu.Unlock()
	paths[w] = append(paths[w], chosen{filepath.Clean(p), now()})
}

// take 检查并作废登记的路径。
func take(w any, p string) bool {
	mu.Lock()
	defer mu.Unlock()
	p = filepath.Clean(p)
	list := paths[w]
	for i, c := range list {
		if c.path == p && now().Sub(c.at) < ChosenTTL {
			paths[w] = append(list[:i:i], list[i+1:]...)
			return true
		}
	}
	return false
}

// Filter 是保存对话框的文件类型。
type Filter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

// Service 是绑定给文档页面的 Export 服务。
type Service struct{}

// ChoosePath 弹保存对话框，返回用户选择的路径（取消时为空字符串）。
func (Service) ChoosePath(ctx context.Context, defaultName string, filters []Filter) (string, error) {
	w := mygo.CallerWindow(ctx)
	if w == nil {
		return "", ErrNotChosen
	}
	fs := make([]mygo.FileFilter, 0, len(filters))
	for _, f := range filters {
		fs = append(fs, mygo.FileFilter{Name: f.Name, Extensions: f.Extensions})
	}
	p, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: w, DefaultPath: defaultName, Filters: fs, CreateDirectories: true})
	if errors.Is(err, mygo.ErrCanceled) || p == "" {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	register(w, p)
	return p, nil
}

// WriteChosen 把数据写到 ChoosePath 选择的路径（原子写入）。
func (Service) WriteChosen(ctx context.Context, path string, data []byte) error {
	w := mygo.CallerWindow(ctx)
	if w == nil || !take(w, path) {
		return ErrNotChosen
	}
	return doc.WriteFileAtomic(path, data)
}
