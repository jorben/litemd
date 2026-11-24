package defaultapp

import "testing"

func TestEvaluate(t *testing.T) {
	const me = "io.github.jorben.litemd"
	cases := []struct {
		name string
		hs   []handler
		want DefaultStatus
	}{
		{"全部是 LiteMd", []handler{{me, "LiteMd"}, {me, "LiteMd"}}, DefaultStatus{Supported: true, IsDefault: true}},
		{".md 是别的应用", []handler{{"app.vmark", "VMark"}, {me, "LiteMd"}}, DefaultStatus{Supported: true, Current: "VMark"}},
		{"只有 .mkd 不是", []handler{{me, "LiteMd"}, {"com.apple.TextEdit", "TextEdit"}}, DefaultStatus{Supported: true, Current: "TextEdit"}},
		{"没有默认应用", []handler{{}, {me, "LiteMd"}}, DefaultStatus{Supported: true}},
		{"查不到任何类型", nil, DefaultStatus{Supported: true}},
	}
	for _, c := range cases {
		if got := evaluate(me, c.hs); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}
