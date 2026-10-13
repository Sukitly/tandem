import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `startApp` reads the user's prompt templates from pi's agent directory. Tests must not depend on the machine's own
// templates, so the directory is pointed at an empty one before any server starts.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "tandem-test-agent-"));
