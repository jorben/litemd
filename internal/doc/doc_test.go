package doc

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func encodeWith(t *testing.T, tr transform.Transformer, s string) []byte {
	t.Helper()
	b, _, err := transform.Bytes(tr, []byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// 打开 → 不改 → 写回：UTF-8 文件逐字节相同（F2.5①④）。
func TestRoundTripUTF8(t *testing.T) {
	cases := map[string]string{
		"lf":          "# 标题\n\n正文\n",
		"crlf":        "# 标题\r\n\r\n正文\r\n",
		"bom":         "\uFEFF# 标题\n正文\n",
		"bom-crlf":    "\uFEFF# 标题\r\n正文\r\n",
		"no-final-nl": "a\nb",
		"empty":       "",
		"crlf-only":   "\r\n",
	}
	for name, src := range cases {
		c := Decode([]byte(src))
		if c.Lossy || c.Encoding != UTF8 {
			t.Fatalf("%s: lossy=%v encoding=%s", name, c.Lossy, c.Encoding)
		}
		if bytes.Contains([]byte(c.Text), []byte("\r")) || bytes.HasPrefix([]byte(c.Text), bomUTF8) {
			t.Fatalf("%s: Text 未归一化: %q", name, c.Text)
		}
		var out bytes.Buffer
		if err := Write(&out, c); err != nil {
			t.Fatal(err)
		}
		if out.String() != src {
			t.Fatalf("%s: 往返不一致\n got %q\nwant %q", name, out.String(), src)
		}
	}
}

// 混合换行：取多数；编辑后统一（F2.5④ 的已知例外）。
func TestMixedEOL(t *testing.T) {
	c := Decode([]byte("a\r\nb\r\nc\nd\r\n"))
	if c.EOL != CRLF || c.Text != "a\nb\nc\nd\n" {
		t.Fatalf("got eol=%q text=%q", c.EOL, c.Text)
	}
	// 不编辑：逐字节还原混合换行
	if string(c.Encode()) != "a\r\nb\r\nc\nd\r\n" {
		t.Fatalf("encode: %q", c.Encode())
	}
	// 改一行保留它原来的换行符；新增的行用主要换行符；其余行不变
	c.Text = "a\nb\nC2\nnew\nd\n"
	if string(c.Encode()) != "a\r\nb\r\nC2\nnew\r\nd\r\n" {
		t.Fatalf("编辑后: %q", c.Encode())
	}
	c = Decode([]byte("a\nb\nc\r\n"))
	if c.EOL != LF {
		t.Fatalf("多数为 LF: %q", c.EOL)
	}
}

func TestUTF16(t *testing.T) {
	src := "# 会议记录\r\n中文 English\r\n"
	for _, tc := range []struct {
		order unicode.Endianness
		want  string
	}{{unicode.LittleEndian, UTF16LE}, {unicode.BigEndian, UTF16BE}} {
		b := encodeWith(t, unicode.UTF16(tc.order, unicode.UseBOM).NewEncoder(), src)
		c := Decode(b)
		if !c.Lossy || c.Encoding != tc.want || c.EOL != CRLF || c.Text != "# 会议记录\n中文 English\n" {
			t.Fatalf("%s: %+v", tc.want, c)
		}
		if err := Write(&bytes.Buffer{}, c); !errors.Is(err, ErrLossy) {
			t.Fatalf("Lossy 文档必须拒绝写回，got %v", err)
		}
	}
}

func TestGB18030(t *testing.T) {
	src := "# 产品周会记录\n\n参会：产品组、研发组\n"
	b := encodeWith(t, simplifiedchinese.GB18030.NewEncoder(), src)
	c := Decode(b)
	if !c.Lossy || c.Encoding != GB18030 || c.Text != src {
		t.Fatalf("%+v", c)
	}
	// 另存为 UTF-8：正文不变，可正常写回
	u := c.UTF8Copy()
	var out bytes.Buffer
	if err := Write(&out, u); err != nil || out.String() != src {
		t.Fatalf("utf8 copy: %v %q", err, out.String())
	}
}

// 不是合法 UTF-8 的任意字节也不会失败（D14：按 GB18030 显示）。
func TestArbitraryBytes(t *testing.T) {
	c := Decode([]byte{0x80, 0xFF, 0x00, 'a', 0xC0})
	if !c.Lossy || c.Encoding != GB18030 {
		t.Fatalf("%+v", c)
	}
}

func TestEqual(t *testing.T) {
	a := Decode([]byte("x\r\n"))
	b := a
	if !Equal(a, b) {
		t.Fatal("相同内容应相等")
	}
	b.Text = "y\n"
	if Equal(a, b) {
		t.Fatal("正文不同不应相等")
	}
}

func TestWriteFileAtomicKeepsMode(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "a.md")
	if err := os.WriteFile(p, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Windows 只有只读位，0o600 会报成 0o666：与写入前系统报告的权限比较
	before, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteFileAtomic(p, []byte("new")); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	fi, _ := os.Stat(p)
	if string(b) != "new" || fi.Mode().Perm() != before.Mode().Perm() {
		t.Fatalf("content=%q mode=%v", b, fi.Mode().Perm())
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("临时文件未清理: %d 个文件", len(entries))
	}
	if UTF8Name("/x/notes.md") != "/x/notes.utf8.md" {
		t.Fatal(UTF8Name("/x/notes.md"))
	}
}
