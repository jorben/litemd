package l10n

import "testing"

func TestIsEnglish(t *testing.T) {
	cases := []struct {
		set  string
		pref []string
		want bool
	}{{"en", []string{"zh-Hans-CN"}, true}, {"zh-Hans", []string{"en-US"}, false}, {"system", []string{"zh-Hans-CN"}, false},
		{"system", []string{"zh-Hant-TW"}, false}, {"system", []string{"de-DE", "zh-Hans"}, true}, {"system", nil, false}}
	for _, c := range cases {
		if got := IsEnglish(c.set, c.pref); got != c.want {
			t.Errorf("IsEnglish(%q, %v) = %v", c.set, c.pref, got)
		}
	}
}

func TestT(t *testing.T) {
	SetEnglish(true)
	defer SetEnglish(false)
	if T("保存") != "Save" || T("没有的条目") != "没有的条目" || F("找不到「%s」", "a.md") != "Can't find “a.md”" {
		t.Fatal(T("保存"), F("找不到「%s」", "a.md"))
	}
}
