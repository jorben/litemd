//go:build e2e

// 自动化测试构建（go build -tags e2e）：链接 mygo 的自动化插件，供 M0/冒烟测试驱动应用。
// 发布构建不含此文件。
package main

import _ "github.com/egoist/mygo/plugins/automation"
