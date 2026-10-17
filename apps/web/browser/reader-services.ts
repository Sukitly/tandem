// Test-only service boundaries. The real readers, controls, and @pierre/diffs renderer are not mocked.
const threads: never[] = [];
export const useCommentThreads = () => threads;
export const useConnected = () => ({ files: { read: async () => ({ kind: "text", text: "context\none\ntail\n" }) } });
export const useWorkbench = () => ({ openFile: () => {}, reportFailure: () => {} });
