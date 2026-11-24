//go:build darwin

package defaultapp

import (
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

// macOS：按扩展名取 UTType（.md 和 .markdown 都是 net.daringfireball.markdown，.mdown、.mkd 是
// 动态类型），用 NSWorkspace 的 URLForApplicationToOpenContentType: 查询、
// setDefaultApplicationAtURL:toOpenContentType:completionHandler: 设置（都是 macOS 12+，
// 最低系统版本为 13.0）。Launch Services 记的是 bundle identifier，所以按它比较，
// 挂载着的 DMG 里那份 LiteMd 也算 LiteMd。

const (
	appKitPath = "/System/Library/Frameworks/AppKit.framework/AppKit"
	utiPath    = "/System/Library/Frameworks/UniformTypeIdentifiers.framework/UniformTypeIdentifiers"
)

// SetTimeout 是等待系统完成一次设置的上限（系统可能先请用户确认）。
var SetTimeout = 2 * time.Minute

var (
	loadOnce sync.Once
	loadErr  error
)

func load() error {
	loadOnce.Do(func() {
		for _, p := range []string{appKitPath, utiPath} {
			if _, err := purego.Dlopen(p, purego.RTLD_LAZY|purego.RTLD_GLOBAL); err != nil {
				loadErr = fmt.Errorf("defaultapp: %w", err)
				return
			}
		}
	})
	return loadErr
}

func sel(name string) objc.SEL { return objc.RegisterName(name) }

func class(name string) objc.ID { return objc.ID(objc.GetClass(name)) }

// withPool 在一个自动释放池里、固定在同一线程上运行 fn。
func withPool(fn func()) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	pool := class("NSAutoreleasePool").Send(sel("alloc")).Send(sel("init"))
	defer pool.Send(sel("drain"))
	fn()
}

func nsString(s string) objc.ID {
	b := append([]byte(s), 0)
	return class("NSString").Send(sel("stringWithUTF8String:"), &b[0])
}

func goString(s objc.ID) string {
	if s == 0 {
		return ""
	}
	p := objc.Send[unsafe.Pointer](s, sel("UTF8String"))
	if p == nil {
		return ""
	}
	n := 0
	for *(*byte)(unsafe.Add(p, n)) != 0 {
		n++
	}
	return string(unsafe.Slice((*byte)(p), n))
}

func workspace() objc.ID { return class("NSWorkspace").Send(sel("sharedWorkspace")) }

// contentType 是一个扩展名对应的 UTType。
type contentType struct {
	ID string
	T  objc.ID
}

// contentTypes 返回 exts 对应的 UTType，去重并保持顺序。须在 withPool 里调用。
func contentTypes(exts []string) []contentType {
	var out []contentType
	seen := map[string]bool{}
	for _, ext := range exts {
		t := class("UTType").Send(sel("typeWithFilenameExtension:"), nsString(ext))
		if t == 0 {
			continue
		}
		id := goString(t.Send(sel("identifier")))
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, contentType{id, t})
	}
	return out
}

// self 返回本应用的 bundle：能设置时 ok 为 true。开发版（mygo dev）和 go test 不声明文件类型。
func self() (id string, url objc.ID, ok bool) {
	b := class("NSBundle").Send(sel("mainBundle"))
	id = goString(b.Send(sel("bundleIdentifier")))
	docs := b.Send(sel("objectForInfoDictionaryKey:"), nsString("CFBundleDocumentTypes"))
	return id, b.Send(sel("bundleURL")), id != "" && docs != 0
}

// handlerFor 返回打开 t 的默认应用。
func handlerFor(t objc.ID) handler {
	u := workspace().Send(sel("URLForApplicationToOpenContentType:"), t)
	if u == 0 {
		return handler{}
	}
	path := u.Send(sel("path"))
	name := strings.TrimSuffix(goString(class("NSFileManager").Send(sel("defaultManager")).Send(sel("displayNameAtPath:"), path)), ".app")
	id := ""
	if b := class("NSBundle").Send(sel("bundleWithURL:"), u); b != 0 {
		id = goString(b.Send(sel("bundleIdentifier")))
	}
	if id == "" {
		id = goString(path)
	}
	return handler{ID: id, Name: name}
}

func status() (DefaultStatus, error) {
	if err := load(); err != nil {
		return DefaultStatus{}, err
	}
	var st DefaultStatus
	withPool(func() {
		id, _, ok := self()
		if !ok {
			return
		}
		var hs []handler
		for _, ct := range contentTypes(Exts) {
			hs = append(hs, handlerFor(ct.T))
		}
		st = evaluate(id, hs)
	})
	return st, nil
}

func setDefault() error {
	if err := load(); err != nil {
		return err
	}
	var err error
	withPool(func() {
		id, url, ok := self()
		if !ok {
			err = ErrUnsupported
			return
		}
		for _, ct := range contentTypes(Exts) {
			if handlerFor(ct.T).ID == id {
				continue
			}
			if e := setHandler(url, ct.T); e != nil {
				err = fmt.Errorf("defaultapp: %s: %w", ct.ID, e)
				return
			}
		}
	})
	return err
}

// setHandler 把 app 设为打开 t 的默认应用，等系统回调。须在 withPool 里调用。
func setHandler(app, t objc.ID) error {
	done := make(chan string, 1)
	blk := objc.NewBlock(func(_ objc.Block, nsErr objc.ID) {
		msg := ""
		if nsErr != 0 {
			msg = goString(nsErr.Send(sel("localizedDescription")))
			if msg == "" {
				msg = "unknown error"
			}
		}
		done <- msg
	})
	defer blk.Release()
	workspace().Send(sel("setDefaultApplicationAtURL:toOpenContentType:completionHandler:"), app, t, blk)
	select {
	case msg := <-done:
		if msg != "" {
			return errors.New(msg)
		}
		return nil
	case <-time.After(SetTimeout):
		return errors.New("timed out")
	}
}
