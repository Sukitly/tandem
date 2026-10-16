/**
 * Contracts shared by the Tandem server and its clients.
 *
 * Everything exported here must run in both Node/Bun and the browser: no runtime-specific imports.
 */

export {
  type ChangedFile,
  type ChangeStatus,
  Changes,
  type ChangesState,
  type FilePatch,
  MAX_CHANGED_FILES,
  MAX_PATCH_BYTES,
  MAX_UNTRACKED_BYTES,
  MAX_UNTRACKED_FILES,
  ProjectChanges,
} from "./changes.ts";
export {
  COMMENT_CONTEXT_LINES,
  type CommentAnchor,
  type CommentMessage,
  type CommentSide,
  Comments,
  type CommentsState,
  type CommentThread,
  MAX_COMMENT_LENGTH,
  MAX_COMMENT_LINE_LENGTH,
  MAX_COMMENT_THREADS,
  MAX_THREAD_MESSAGES,
  waitingMessages,
} from "./comments.ts";
export {
  Conversation,
  type ConversationNotice,
  type ConversationNotices,
  type ConversationSummary,
  Conversations,
  type ConversationsState,
  type ConversationTps,
  type ConversationView,
  MAX_CONVERSATION_TITLE_LENGTH,
  type RunTps,
  type StartInput,
  type SubmitInput,
} from "./conversations.ts";
export {
  AUTH_PATH,
  type DeviceSummary,
  Devices,
  type DevicesState,
  PAIR_CODE_PATH,
  PAIR_PATH,
  type PairingCode,
  PROOF_PATH,
  type ProofRequest,
  type ProofResponse,
  SIGN_OUT_PATH,
} from "./devices.ts";
export { type FileContent, type FileEntry, type FileLocation, Files, MAX_FILE_VIEW_BYTES } from "./files.ts";
export {
  IMAGE_INPUT_TYPES,
  IMAGE_PATH,
  type ImageInput,
  type ImageRef,
  imagePath,
  MAX_MESSAGE_IMAGE_BYTES,
  type PageImageBlock,
  type WithImageRefs,
} from "./images.ts";
export {
  type AuthType,
  type LoginEvent,
  type LoginPrompt,
  type LoginState,
  type ModelRef,
  type ModelSummary,
  Models,
  type ModelsState,
  type ProviderSummary,
} from "./models.ts";
export {
  PREVIEW_PATH,
  Preview,
  type PreviewPort,
  type PreviewState,
  parsePreviewTarget,
  previewPath,
  previewUrl,
  type RegisterPortInput,
  type UnregisterPortInput,
} from "./preview.ts";
export {
  type PromptOrigin,
  Prompts,
  type PromptTemplateSummary,
} from "./prompts.ts";
export { type PullRequest, Repository, type RepositoryState } from "./repository.ts";
export {
  clampTerminalSize,
  exitLabel,
  MAX_TERMINALS_PER_PROJECT,
  TERMINAL_BAD_MESSAGE,
  TERMINAL_CLOSED,
  TERMINAL_MAX_SIZE,
  TERMINAL_MIN_SIZE,
  TERMINAL_SCROLLBACK,
  TERMINAL_START_SIZE,
  type TerminalControl,
  type TerminalEvent,
  type TerminalSize,
  type TerminalSummary,
  Terminals,
  type TerminalsState,
  terminalPath,
} from "./terminals.ts";
export {
  checkedIdentity,
  PublicAccess,
  type PublicAccessState,
  type PublicAccessStatus,
  type PublishInput,
  type TunnelIdentity,
  tunnelTokenIdentity,
} from "./tunnel.ts";
export {
  type ProviderUsage,
  Usage,
  type UsageState,
  type UsageWindow,
} from "./usage.ts";
export {
  type ProjectDirectory,
  type WorkspaceSummary,
  Workspaces,
  type WorkspacesState,
} from "./workspaces.ts";

/** The server only listens on the loopback interface. */
export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_PORT = 4820;

export const DEV_PORT = 4821;

/** WebSocket path carrying pi-protocol frames (service calls and replicated state). */
export const RPC_PATH = "/rpc";

/** WebSocket path prefix for raw terminal byte streams: `${PTY_PATH}/<terminalId>`. */
export const PTY_PATH = "/pty";

export const HEALTH_PATH = "/health";

/**
 * Returns what a client needs before it can connect to `RPC_PATH`. Requires a device cookie or the installation master key in an Authorization header.
 */
export const BOOTSTRAP_PATH = "/bootstrap";

/**
 * Where the tunnel process has got to. `unavailable` means the `cloudflared` program is not installed, and `failed`
 * means it exited without registering a connection.
 */
export type TunnelState = "starting" | "connected" | "failed" | "unavailable";

export interface HealthResponse {
  status: "ok";
  version: string;
  /** Absent when this installation runs no tunnel. */
  tunnel?: TunnelState;
}

export interface BootstrapResponse {
  /** Logical server identity the client must expect during the pi-protocol handshake. */
  serverId: string;
  /** Present for a paired browser, absent for master-key clients. */
  deviceId?: string;
}
