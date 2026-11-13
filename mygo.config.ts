// 由 Node.js 直接执行（去除类型），只能用可去除类型的 TS 语法（技术方案 1.2 节）。
import type { defineConfig } from "./frontend/node_modules/mygo-cli/index.js";

type Config = Parameters<typeof defineConfig>[0];

const config: Config = {
  name: "LiteMd",
  slug: "litemd",
  identifier: "io.github.jorben.litemd",
  version: "0.1.0",
  copyright: "© 2026 Jorben",
  license: "Apache-2.0",
  devUrl: "http://localhost:5173",
  devCommand: "pnpm -C frontend dev:web",
  buildCommand: "pnpm -C frontend build:web",
  frontendDist: "frontend/dist",
  bindings: "frontend/src/mygo.ts",
  out: "build",
  fileAssociations: [
    { ext: ["md", "markdown", "mdown", "mkd"], name: "Markdown Document", mimeType: "text/markdown" },
  ],
  // F11.4：自动更新。安装包是否可信靠这把公钥对应私钥的签名（与 Windows 代码签名无关，D6）。
  // 私钥不在仓库里：本机在 mygo keygen 的默认目录，发布时放 CI secrets 的 MYGO_UPDATER_PRIVATE_KEY。
  updates: { publicKey: "/lJ+DTek+ra7DYzv7kd9ytosRc7c8fpc86lx+wixxa0=", github: "jorben/litemd" },
  macos: {
    minimumSystemVersion: "13.0", // 技术方案 3.9 节
    // 本机构建为 ad-hoc 签名；发布工作流从 secrets 导入 Developer ID 证书并设置这两个环境变量（F11.1）
    signingIdentity: process.env.MACOS_SIGNING_IDENTITY || "-",
    ...(process.env.NOTARY_KEYCHAIN ? { notarize: { keychainProfile: "notary", keychain: process.env.NOTARY_KEYCHAIN } } : {}),
  },
};

export default config;
