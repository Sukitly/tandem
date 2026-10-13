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
  type ConversationView,
  type StartInput,
  type SubmitInput,
} from "./conversations.ts";
export { type FileContent, type FileEntry, type FileLocation, Files, MAX_FILE_VIEW_BYTES } from "./files.ts";
export {
  IMAGE_INPUT_TYPES,
  IMAGE_PATH,
  type ImageInput,
  type ImageRef,
  imagePath,
  MAX_MESSAGE_IMAGE_BYTES,
  type PageImageBlock,
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
  type PromptOrigin,
  Prompts,
  type PromptTemplateSummary,
} from "./prompts.ts";
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
export { type ProjectDirectory, type WorkspaceSummary, Workspaces, type WorkspacesState } from "./workspaces.ts";

/** The server only listens on the loopback interface. */
export const DEFAULT_HOST = "127.0.0.1";

export const DEFAULT_PORT = 4820;

/** WebSocket path carrying pi-protocol frames (service calls and replicated state). */
export const RPC_PATH = "/rpc";

/** WebSocket path prefix for raw terminal byte streams: `${PTY_PATH}/<terminalId>`. */
export const PTY_PATH = "/pty";

export const HEALTH_PATH = "/health";

/**
 * Returns what a client needs before it can connect to `RPC_PATH`. Requires the session token as a bearer token.
 */
export const BOOTSTRAP_PATH = "/bootstrap";

/** Query parameter that carries the session token on WebSocket URLs, which cannot set request headers in browsers. */
export const TOKEN_QUERY_PARAMETER = "token";

export interface HealthResponse {
  status: "ok";
  version: string;
}

export interface BootstrapResponse {
  /** Logical server identity the client must expect during the pi-protocol handshake. */
  serverId: string;
}
