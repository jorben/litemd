// Package doc 定义 LiteMd 的文档内容模型 MdContent 及其读写（技术方案 3.2 节）。
//
// 读入时去掉 BOM、把换行统一为 \n，记下原文件的编码、BOM 和主要换行符；写出时还原。
// 非 UTF-8 文件（带 BOM 的 UTF-16、其余一律按 GB18030 显示）为 Lossy：只读，Write 拒绝写回（D14）。
package doc

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// 编码名（Encoding 字段的取值）。
const (
	UTF8    = "utf-8"
	UTF16LE = "utf-16le"
	UTF16BE = "utf-16be"
	GB18030 = "gb18030"
)

// 换行符（EOL 字段的取值）。
const (
	LF   = "\n"
	CRLF = "\r\n"
)

// MdContent 是一个 Markdown 文档的内容。
type MdContent struct {
	Text     string `json:"text"`     // 归一化后的正文：无 BOM，换行为 \n
	BOM      bool   `json:"bom"`      // 原文件有 UTF-8 BOM
	EOL      string `json:"eol"`      // 原文件的主要换行符：LF 或 CRLF
	Encoding string `json:"encoding"` // UTF8、UTF16LE、UTF16BE、GB18030
	Lossy    bool   `json:"lossy"`    // 非 UTF-8：只读，禁止写回
}

// ErrLossy 由 Write 返回：非 UTF-8 文档不能写回（D14），要用「另存为 UTF-8」。
var ErrLossy = errors.New("doc: 此文件不是 UTF-8 编码，不能写回")

var (
	bomUTF8    = []byte{0xEF, 0xBB, 0xBF}
	bomUTF16LE = []byte{0xFF, 0xFE}
	bomUTF16BE = []byte{0xFE, 0xFF}
)

// New 返回新建文档的内容：UTF-8、LF、无 BOM。
func New() MdContent { return MdContent{EOL: LF, Encoding: UTF8} }

// Decode 把文件的字节解码为 MdContent。
func Decode(b []byte) MdContent {
	c := MdContent{Encoding: UTF8}
	var text string
	switch {
	case bytes.HasPrefix(b, bomUTF8):
		c.BOM = true
		text = string(b[len(bomUTF8):])
		if !utf8.ValidString(text) {
			// 有 UTF-8 BOM 但内容不合法：按其余字节的 GB18030 解码处理
			c.BOM = false
			text, c.Encoding, c.Lossy = decodeGB18030(b), GB18030, true
		}
	case bytes.HasPrefix(b, bomUTF16LE):
		text, c.Encoding, c.Lossy = decodeUTF16(b, unicode.LittleEndian), UTF16LE, true
	case bytes.HasPrefix(b, bomUTF16BE):
		text, c.Encoding, c.Lossy = decodeUTF16(b, unicode.BigEndian), UTF16BE, true
	case utf8.Valid(b):
		text = string(b)
	default:
		// GB18030 几乎能解码任何字节序列；Shift-JIS、Latin-1 等会显示乱码，D14 接受
		text, c.Encoding, c.Lossy = decodeGB18030(b), GB18030, true
	}
	crlf := strings.Count(text, "\r\n")
	lf := strings.Count(text, "\n") - crlf
	c.EOL = LF
	if crlf > lf {
		c.EOL = CRLF
	}
	c.Text = strings.ReplaceAll(text, "\r\n", "\n")
	return c
}

func decodeUTF16(b []byte, order unicode.Endianness) string {
	out, _, err := transform.Bytes(unicode.UTF16(order, unicode.ExpectBOM).NewDecoder(), b)
	if err != nil {
		return string(bytes.ToValidUTF8(out, []byte("\uFFFD")))
	}
	return string(out)
}

func decodeGB18030(b []byte) string {
	out, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), b)
	if err != nil {
		return string(bytes.ToValidUTF8(b, []byte("\uFFFD")))
	}
	return string(out)
}

// Encode 把内容编码为要写盘的 UTF-8 字节：还原换行符和 BOM。
func (c MdContent) Encode() []byte {
	text := c.Text
	if c.EOL == CRLF {
		text = strings.ReplaceAll(text, "\n", "\r\n")
	}
	if c.BOM {
		return append(append([]byte{}, bomUTF8...), text...)
	}
	return []byte(text)
}

// Read 供 mygo NewDocuments 使用。
func Read(r io.Reader) (MdContent, error) {
	b, err := io.ReadAll(r)
	if err != nil {
		return MdContent{}, err
	}
	return Decode(b), nil
}

// Write 供 mygo NewDocuments 使用；mygo 负责临时文件和原子替换（F2.7）。
func Write(w io.Writer, c MdContent) error {
	if c.Lossy {
		return ErrLossy
	}
	_, err := w.Write(c.Encode())
	return err
}

// Equal 比较全部字段：撤销回原文时文档回到「未编辑」。
func Equal(a, b MdContent) bool { return a == b }

// UTF8Copy 返回另存为 UTF-8 时写出的内容：正文不变，编码改为 UTF-8、无 BOM，换行沿用原文件。
func (c MdContent) UTF8Copy() MdContent {
	return MdContent{Text: c.Text, EOL: c.EOL, Encoding: UTF8}
}

// WriteFileAtomic 把内容原子写入 path（临时文件 + rename），保留已有文件的权限。
// 只用于「另存为 UTF-8」这类不经过 mygo 文档保存流程的写盘（技术方案 3.2 节）。
func WriteFileAtomic(path string, data []byte) error {
	mode := os.FileMode(0o644)
	if fi, err := os.Stat(path); err == nil {
		mode = fi.Mode().Perm()
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".litemd-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// UTF8Name 返回「另存为 UTF-8」的默认文件名：同名加 .utf8 后缀，如 notes.md → notes.utf8.md。
func UTF8Name(path string) string {
	ext := filepath.Ext(path)
	return strings.TrimSuffix(path, ext) + ".utf8" + ext
}
