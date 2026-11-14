# LiteMd 常用命令。运行 `make` 或 `make help` 查看全部目标。
# 兼容 macOS 自带的 GNU Make 3.81。mygo CLI 一律用 go.mod 固定的 `go tool mygo`（技术方案 1.2 节）。
#
# 额外参数用 ARGS 传给 mygo，例如：
#   make build ARGS="-platform windows/amd64"
#   make dev ARGS="-lang en"

MYGO    ?= go tool mygo
PNPM    ?= pnpm -C frontend
ARGS    ?=
GOFILES := main.go internal scripts/make-icon

E2E_OUT  := /tmp/litemd-e2e
PERF_OUT := /tmp/litemd-perf

# 前端依赖：package.json 或锁文件比 node_modules 新时才重新安装
DEPS := frontend/node_modules/.modules.yaml

.DEFAULT_GOAL := help

.PHONY: help install dev build build-app generate icon \
	test test-go test-web typecheck lint vet fmt fmt-check generate-check check \
	golden smoke perf clean

help: ## 列出所有目标
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

$(DEPS): frontend/package.json frontend/pnpm-lock.yaml
	$(PNPM) install --frozen-lockfile
	@touch $@

install: $(DEPS) ## 安装前端依赖（锁文件有变化时才重新安装）

# ── 开发与构建 ───────────────────────────────────────────

dev: $(DEPS) ## 开发：启动 Vite 和开发版 LiteMd Dev（带 Dev 徽章图标），改代码自动重建
	$(MYGO) dev $(ARGS)

build: $(DEPS) ## 打包正式版到 build/：.app 与 DMG（本机为 ad-hoc 签名）
	$(MYGO) build $(ARGS)

build-app: $(DEPS) ## 只打包 .app，跳过 DMG（更快）
	$(MYGO) build -skip-dmg $(ARGS)

generate: ## 修改 Go 服务后，重新生成 frontend/src/mygo.ts
	$(MYGO) generate

icon: ## 用 docs/images/icon-source.png 重新生成正式版、开发版和网页图标
	go run -C scripts/make-icon .

# ── 测试与检查 ───────────────────────────────────────────

test: test-go test-web ## 运行 Go 与前端测试

test-go: ## Go 测试（带竞态检测）
	go test -race ./...

test-web: $(DEPS) ## 前端单元测试与保真回归（testdata/fidelity/）
	$(PNPM) test

typecheck: $(DEPS) ## 前端类型检查
	$(PNPM) typecheck

lint: vet fmt-check $(DEPS) ## go vet、gofmt 检查与前端 ESLint
	$(PNPM) lint

vet: ## go vet（主模块与图标脚本）
	go vet ./...
	cd scripts/make-icon && go vet .

fmt: ## 用 gofmt 格式化 Go 代码
	gofmt -w $(GOFILES)

fmt-check: ## 检查 Go 代码格式
	@out=$$(gofmt -l $(GOFILES)); if [ -n "$$out" ]; then echo "需要 gofmt 的文件："; echo "$$out"; exit 1; fi

generate-check: ## 检查 frontend/src/mygo.ts 是否与 Go 服务一致
	$(MYGO) generate
	git diff --exit-code frontend/src/mygo.ts

check: lint test-go generate-check typecheck test-web ## 提交前运行与 CI 相同的检查

golden: ## 修改菜单快捷键后，更新快捷键表和文档
	LITEMD_UPDATE_GOLDEN=1 go test ./internal/menu

# ── macOS 冒烟与性能（需要 PATH 中有 mygo-automation） ──

smoke: $(DEPS) ## 构建带自动化插件的版本并运行 macOS 冒烟清单
	GOFLAGS=-tags=e2e $(MYGO) build -skip-dmg -o $(E2E_OUT)
	sh scripts/smoke-macos.sh

perf: $(DEPS) ## 构建 -debug 自动化版本并运行性能测量（docs/perf-report.md）
	GOFLAGS=-tags=e2e $(MYGO) build -debug -skip-dmg -o $(PERF_OUT)
	python3 scripts/perf.py $(ARGS)

clean: ## 删除构建产物：build/、.mygo/、frontend/dist/ 与冒烟、性能构建
	rm -rf build .mygo frontend/dist litemd $(E2E_OUT) $(PERF_OUT)
