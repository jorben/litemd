// Package settings 读写 LiteMd 的设置（PRD F10，技术方案 3.7 节）。
//
// 存在 PathUserData/settings.json，带 version 字段；新增字段一律有默认值，读入旧文件时缺的字段取默认。
// 自动保存开关只在启动时生效（D11）：AutosaveAtLaunch 记下启动时的值，页面据此提示「重启后生效」。
package settings

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"

	"github.com/jorben/litemd/internal/doc"
)

// Version 是当前设置文件的版本。
const Version = 1

// Settings 是全部设置项。
type Settings struct {
	Version int `json:"version"`
	// 通用
	DefaultMode   string `json:"defaultMode"`   // preview（D1）/ wysiwyg / source / remember
	Autosave      bool   `json:"autosave"`      // D2：默认开启；D11：重启后生效
	RestoreWindow bool   `json:"restoreWindow"` // 按文件记住窗口大小和位置
	Language      string `json:"language"`      // system / zh-Hans / en
	// 编辑
	ImageRule   string `json:"imageRule"`   // assets（D4）/ named / same / custom
	ImageCustom string `json:"imageCustom"` // custom 时的相对路径
	PasteRich   bool   `json:"pasteRich"`   // 粘贴时把富文本转换为 Markdown
	SpellCheck  bool   `json:"spellCheck"`  // F5.11：默认关闭
	TabWidth    int    `json:"tabWidth"`    // 代码块 Tab 宽度
	// 外观
	Theme     string  `json:"theme"`     // system / light / dark
	FontScale float64 `json:"fontScale"` // 字号缩放（F9.2）
	Width     string  `json:"width"`     // narrow / medium / wide / full（F9.3）
	BodyFont  string  `json:"bodyFont"`
	CodeFont  string  `json:"codeFont"`
	// 隐私
	NetworkImages bool `json:"networkImages"` // F6.2
	AutoUpdate    bool `json:"autoUpdate"`    // F11.4
	// 界面
	StatusBar bool `json:"statusBar"`
}

// Defaults 返回出厂设置。
func Defaults() Settings {
	return Settings{
		Version: Version, DefaultMode: "preview", Autosave: true, RestoreWindow: true, Language: "system",
		ImageRule: "assets", ImageCustom: "images", PasteRich: true, SpellCheck: false, TabWidth: 4,
		Theme: "system", FontScale: 1, Width: "medium", BodyFont: "system", CodeFont: "system",
		NetworkImages: true, AutoUpdate: true, StatusBar: true,
	}
}

var (
	validMode  = map[string]bool{"preview": true, "wysiwyg": true, "source": true, "remember": true}
	validRule  = map[string]bool{"assets": true, "named": true, "same": true, "custom": true}
	validTheme = map[string]bool{"system": true, "light": true, "dark": true}
	validWidth = map[string]bool{"narrow": true, "medium": true, "wide": true, "full": true}
	validLang  = map[string]bool{"system": true, "zh-Hans": true, "en": true}
)

// Normalize 把非法值改回默认值（手改坏的文件、旧版本写入的值）。
func (s Settings) Normalize() Settings {
	d := Defaults()
	if !validMode[s.DefaultMode] {
		s.DefaultMode = d.DefaultMode
	}
	if !validRule[s.ImageRule] {
		s.ImageRule = d.ImageRule
	}
	if !validTheme[s.Theme] {
		s.Theme = d.Theme
	}
	if !validWidth[s.Width] {
		s.Width = d.Width
	}
	if !validLang[s.Language] {
		s.Language = d.Language
	}
	if s.TabWidth != 2 && s.TabWidth != 4 && s.TabWidth != 8 {
		s.TabWidth = d.TabWidth
	}
	if s.FontScale < 0.5 || s.FontScale > 2 {
		s.FontScale = d.FontScale
	}
	if s.BodyFont == "" {
		s.BodyFont = d.BodyFont
	}
	if s.CodeFont == "" {
		s.CodeFont = d.CodeFont
	}
	s.Version = Version
	return s
}

// Decode 解析设置文件：缺的字段取默认值（先填默认再覆盖），非法值改回默认。
func Decode(b []byte) (Settings, error) {
	s := Defaults()
	if len(b) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return Defaults(), err
	}
	return s.Normalize(), nil
}

// Store 是设置的存储。
type Store struct {
	mu   sync.Mutex
	path string
	cur  Settings
	// AutosaveAtLaunch 是启动时的自动保存设置（D11）。
	AutosaveAtLaunch bool
}

// Open 读取 dir/settings.json；不存在或损坏时用默认值。
func Open(dir string) *Store {
	st := &Store{path: filepath.Join(dir, "settings.json"), cur: Defaults()}
	if b, err := os.ReadFile(st.path); err == nil {
		if s, err := Decode(b); err == nil {
			st.cur = s
		}
	}
	st.AutosaveAtLaunch = st.cur.Autosave
	return st
}

// Get 返回当前设置。
func (st *Store) Get() Settings {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.cur
}

// Set 保存设置并返回规范化后的值。
func (st *Store) Set(s Settings) (Settings, error) {
	s = s.Normalize()
	st.mu.Lock()
	st.cur = s
	path := st.path
	st.mu.Unlock()
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return s, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return s, err
	}
	return s, doc.WriteFileAtomic(path, append(b, '\n'))
}

// Default 是应用的设置存储，main 在启动时打开。
var Default = &Store{cur: Defaults(), AutosaveAtLaunch: true}

// Load 打开 PathUserData 下的设置。必须在 NewDocuments 之前调用（自动保存模式只能在那时设定）。
func Load() {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return
	}
	Default = Open(dir)
}

// AutosaveMode 返回传给 NewDocuments 的自动保存模式。
func AutosaveMode() mygo.Autosave {
	if Default.AutosaveAtLaunch {
		return mygo.AutosaveInPlace
	}
	return mygo.AutosaveOff
}

// Changed 在设置改动后广播给所有窗口。
var Changed = mygo.NewEvent[View]("settings-changed")

// View 是页面看到的设置：外加自动保存在本次运行中是否生效。
type View struct {
	Settings
	AutosaveEffective bool `json:"autosaveEffective"`
}

func view() View { return View{Settings: Default.Get(), AutosaveEffective: Default.AutosaveAtLaunch} }

// OnChange 由 main 注入（例如通知 assets 图片规则、刷新菜单）。
var OnChange = func(Settings) {}

// ErrInvalid：页面传来的设置无法解析。
var ErrInvalid = errors.New("settings: 无效的设置")

// Service 是绑定给页面的 Settings 服务。
type Service struct{}

// Get 返回当前设置。
func (Service) Get(context.Context) View { return view() }

// Set 保存设置，并广播给所有窗口。
func (Service) Set(_ context.Context, s Settings) (View, error) {
	saved, err := Default.Set(s)
	OnChange(saved)
	v := view()
	_ = Changed.Broadcast(v)
	return v, err
}

// ShowTab 让设置窗口切到某个分组（「关于 LiteMd」）。
var ShowTab = mygo.NewEvent[string]("settings-tab")

// AppVersion 返回应用版本（关于页）。
func (Service) AppVersion(context.Context) string { return mygo.App.Version() }
