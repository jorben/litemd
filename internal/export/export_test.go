package export

import (
	"testing"
	"time"
)

func TestChosenPaths(t *testing.T) {
	clock := time.Unix(100, 0)
	now = func() time.Time { return clock }
	defer func() { now = time.Now }()
	register("w1", "/out/a.png")
	if take("w2", "/out/a.png") {
		t.Fatal("其他窗口不能用")
	}
	if take("w1", "/etc/passwd") {
		t.Fatal("没选过的路径不能写")
	}
	if !take("w1", "/out/./a.png") {
		t.Fatal("选过的路径可以写一次")
	}
	if take("w1", "/out/a.png") {
		t.Fatal("写一次后作废")
	}
	register("w1", "/out/b.png")
	clock = clock.Add(ChosenTTL + time.Second)
	if take("w1", "/out/b.png") {
		t.Fatal("过期后作废")
	}
}
