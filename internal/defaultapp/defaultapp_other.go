//go:build !darwin

package defaultapp

// Windows 不允许应用直接改默认应用（UserChoice 有哈希保护），Linux 需要知道安装方式对应的
// desktop 文件名，都还没有实现：设置页不显示这一项。

func status() (DefaultStatus, error) { return DefaultStatus{}, nil }

func setDefault() error { return ErrUnsupported }
