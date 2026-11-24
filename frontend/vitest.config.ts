import { defineConfig } from "vitest/config";
import { aliases } from "./aliases.ts";

// 依赖 CPU 时钟或时间预算的测试（复杂度指数、耗时上限）：单独串行运行，允许重试 2 次。
// 与其他测试并行时会被机器负载干扰（M0 报告「迁入测试的处理」）；真正退化为二次复杂度时
// 指数稳定在 ~2，重试不会掩盖。
const TIMING = [
  "src/vmark/utils/markdownPipeline/nestingDepth.test.ts",
  "src/vmark/utils/markdownPipeline/serializerCodeRanges.test.ts",
  "src/vmark/utils/markdownPipeline/parser/mathSourceGuards.test.ts",
  "src/vmark/utils/markdownPipeline/parser/mathDelimiterSpans.test.ts",
  "src/vmark/utils/markdownPipeline/__tests__/performance.test.ts",
  "src/vmark/utils/markdownPipeline/__tests__/pathological/pathologicalScaling.test.ts",
];

// 整个保真语料库（testdata/fidelity，260 多份）在一个用例里跑完的测试：Windows CI 上正常就要 35–55 秒，
// 机器稍忙就超过单元测试的 60 秒上限（与结果无关）。单独成项目、放宽到 180 秒，只防卡死，不当作性能断言。
const CORPUS = ["test/fidelity/**/*.test.ts"];

const shared = {
  resolve: { alias: aliases },
  define: { __VMARK_VERSION__: JSON.stringify("0.0.0-test") },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          setupFiles: ["./test/setupDom.ts"],
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: [...TIMING, ...CORPUS],
          testTimeout: 60_000,
        },
      },
      {
        ...shared,
        test: {
          name: "corpus",
          globals: true,
          environment: "node",
          setupFiles: ["./test/setupDom.ts"],
          include: CORPUS,
          testTimeout: 180_000,
        },
      },
      {
        ...shared,
        test: {
          name: "timing",
          globals: true,
          environment: "node",
          setupFiles: ["./test/setupDom.ts"],
          include: TIMING,
          fileParallelism: false,
          retry: 2,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
