//go:build darwin

package defaultapp

import "testing"

// 只查询，不修改系统设置。
func TestContentTypes(t *testing.T) {
	if err := load(); err != nil {
		t.Fatal(err)
	}
	var ids []string
	withPool(func() {
		for _, ct := range contentTypes(Exts) {
			ids = append(ids, ct.ID)
		}
	})
	// .md 与 .markdown 是同一个类型，去重后最多 3 个
	if len(ids) == 0 || len(ids) > 3 || ids[0] != "net.daringfireball.markdown" {
		t.Fatalf("%v", ids)
	}
}

// go test 的可执行文件不在声明了文件类型的 bundle 里：不支持设置，也不报错。
func TestStatusOutsideBundle(t *testing.T) {
	st, err := status()
	if err != nil || st.Supported {
		t.Fatalf("%+v %v", st, err)
	}
	if err := setDefault(); err != ErrUnsupported {
		t.Fatalf("setDefault: %v", err)
	}
}
