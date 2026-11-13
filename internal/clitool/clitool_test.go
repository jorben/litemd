package clitool

import (
	"strings"
	"testing"
)

func TestScript(t *testing.T) {
	s := Script("/Applications/Lite Md.app/Contents/MacOS/LiteMd")
	if !strings.HasPrefix(s, "#!/bin/sh\n") || !strings.Contains(s, `"/Applications/Lite Md.app/Contents/MacOS/LiteMd" "$@"`) {
		t.Fatal(s)
	}
	if shellQuote("a'b") != `'a'\''b'` {
		t.Fatal(shellQuote("a'b"))
	}
}
