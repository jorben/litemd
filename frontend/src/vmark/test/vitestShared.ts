// LiteMd 自有文件：vmark 根目录 vitest.shared.ts 中被迁入测试用到的常量（该文件本身不迁，
// 其余内容是 vmark 测试分层与线程池的调优）。值与 vmark@01bf9f4 相同。
/** 测试超时是「卡死」的判定，不是性能断言。 */
export const LIVENESS_TIMEOUT_MS = 300_000;
