/**
 * herdr surface layer — backend for spawning subagents in herdr panes.
 *
 * Mirrors the primitives in tmux.ts (create/split a pane, type a command,
 * read its screen, close it) so tmux.ts can delegate to either backend.
 * Panes are identified by herdr pane ids (e.g. "w2:p4").
 *
 * Herdr panes on Windows start PowerShell, but the extension's launch lines
 * use POSIX shell syntax (`cd 'x' && pi …; echo '__SUBAGENT_DONE_'$?'__'`).
 * Every spawned pane therefore gets an interactive Git bash as its shell
 * before the first command is typed, which keeps tmux pane semantics intact
 * (launch lines, sentinels, and `bash <script>` all behave exactly as under
 * tmux). Message delivery is unaffected: while pi runs, typed text goes to
 * the TUI's stdin either way.
 *
 * Bare `bash` is never invoked from PowerShell: on Windows it can resolve to
 * WSL's bash.exe instead of Git bash, so the explicit path below is used.
 *
 * Note on herdr CLI behavior: every command except `pane read` answers with a
 * JSON envelope (`{id, result}` or `{id, error}`) and exits 0 even on errors —
 * errors must be detected by parsing the envelope. `pane read` prints plain
 * terminal text on stdout.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HERDR_BIN = process.env.PI_SUBAGENT_HERDR_BIN ?? "herdr";
const HERDR_PANE_BASH =
  process.env.PI_SUBAGENT_BASH ?? "C:\\Program Files\\Git\\bin\\bash.exe";

/**
 * Readiness marker for the PowerShell → bash handoff. The underscore is
 * written as an octal escape in the typed line, so the terminal's echo of the
 * command line can never match the marker itself — only bash's output can.
 */
const BASH_READY_MARKER = "__PI_SUBAGENT_BASH_READY__";
const BASH_READY_CMD = "printf '\\137\\137PI_SUBAGENT_BASH_READY\\137\\137\\n'";
const BASH_READY_ATTEMPTS = 10;
const BASH_READY_WAIT_MS = 1500;

// ── CLI plumbing ──

function parseEnvelope(stdout: string, context: string): any {
  const trimmed = stdout.trim();
  // Fire-and-forget commands (run, send-text, send-keys, close) print nothing
  // on success.
  if (trimmed === "") return undefined;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`herdr ${context}: unexpected output: ${stdout.slice(0, 200)}`);
  }
  if (parsed && parsed.error) {
    const code = parsed.error.code ? `${parsed.error.code}: ` : "";
    throw new Error(`herdr ${context} failed: ${code}${parsed.error.message ?? ""}`);
  }
  return parsed?.result;
}

function herdrSync(args: string[], context: string): any {
  let stdout: string;
  try {
    stdout = execFileSync(HERDR_BIN, args, { encoding: "utf8" });
  } catch (err: any) {
    throw new Error(`herdr ${context} failed: ${err?.message ?? String(err)}`);
  }
  return parseEnvelope(stdout, context);
}

function readPaneTextSync(surface: string, lines: number): string {
  let stdout: string;
  try {
    stdout = execFileSync(
      HERDR_BIN,
      ["pane", "read", surface, "--lines", String(Math.max(1, lines))],
      { encoding: "utf8" },
    );
  } catch (err: any) {
    throw new Error(`herdr pane read failed: ${err?.message ?? String(err)}`);
  }
  // Errors still exit 0 and come back as a JSON envelope.
  if (stdout.trimStart().startsWith('{"id":"cli:pane:read","error"')) {
    parseEnvelope(stdout, "pane read");
  }
  return stdout;
}

async function readPaneTextAsync(surface: string, lines: number): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      HERDR_BIN,
      ["pane", "read", surface, "--lines", String(Math.max(1, lines))],
      { encoding: "utf8" },
    ));
  } catch (err: any) {
    throw new Error(`herdr pane read failed: ${err?.message ?? String(err)}`);
  }
  if (stdout.trimStart().startsWith('{"id":"cli:pane:read","error"')) {
    parseEnvelope(stdout, "pane read");
  }
  return stdout;
}

// ── Availability & pane identity ──

let cachedParentPane: string | undefined;

/**
 * The pane hosting this pi process. Resolved through `herdr pane current
 * --current`, which maps the calling process to its pane via process lineage
 * (not keyboard focus), so it stays correct while the user works elsewhere.
 * `PI_SUBAGENT_PARENT_PANE` overrides for tests or unusual setups.
 */
export function currentPaneId(): string | undefined {
  if (process.env.PI_SUBAGENT_PARENT_PANE) return process.env.PI_SUBAGENT_PARENT_PANE;
  if (cachedParentPane) return cachedParentPane;
  try {
    const result = herdrSync(["pane", "current", "--current"], "pane current");
    const id = result?.pane?.pane_id;
    if (typeof id === "string" && id) {
      cachedParentPane = id;
      return id;
    }
  } catch {
    // Server not running or not inside a herdr pane.
  }
  return undefined;
}

/** True when a herdr server is reachable and this process lives in a pane. */
export function isHerdrAvailable(): boolean {
  return currentPaneId() !== undefined;
}

// ── Surface primitives ──

/**
 * Start an interactive Git bash in the pane and wait until it parses input.
 * Retries the readiness probe: if the probe line lands while PowerShell still
 * owns the terminal it is consumed as a PowerShell command (which cannot
 * print the marker), and is re-sent once bash is up.
 */
function startBashShell(pane: string): void {
  herdrSync(["pane", "run", pane, `& '${HERDR_PANE_BASH}' --norc -i`], "pane run bash");
  for (let attempt = 0; attempt < BASH_READY_ATTEMPTS; attempt++) {
    try {
      herdrSync(["pane", "send-text", pane, BASH_READY_CMD], "send-text");
      herdrSync(["pane", "send-keys", pane, "Enter"], "send-keys");
    } catch (err) {
      throw new Error(`herdr: failed to start bash in pane ${pane}: ${err}`);
    }
    try {
      const result = herdrSync(
        [
          "pane",
          "wait-output",
          pane,
          "--match",
          BASH_READY_MARKER,
          "--timeout",
          String(BASH_READY_WAIT_MS),
        ],
        "wait-output",
      );
      if (result?.matched === false) continue;
      return;
    } catch {
      // Timeout — probe again.
    }
  }
  throw new Error(
    `herdr: bash did not become ready in pane ${pane}. ` +
      `Check that Git bash is installed at ${HERDR_PANE_BASH} ` +
      `(override with PI_SUBAGENT_BASH).`,
  );
}

/**
 * Create a new pane for a subagent: a right split off the parent pi's pane,
 * then hand the pane shell over to bash. Returns the new pane id.
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  const parent = fromSurface ?? currentPaneId();
  if (!parent) {
    throw new Error("herdr: cannot resolve the parent pi pane");
  }
  // herdr only splits right/down; left/up collapse onto those.
  const dir = direction === "left" || direction === "right" ? "right" : "down";
  const result = herdrSync(
    ["pane", "split", "--pane", parent, "--direction", dir, "--no-focus"],
    "pane split",
  );
  const pane = result?.pane?.pane_id;
  if (typeof pane !== "string" || !pane) {
    throw new Error(`herdr pane split: unexpected response: ${JSON.stringify(result).slice(0, 200)}`);
  }
  startBashShell(pane);
  return pane;
}

/**
 * Send a command string to a pane and execute it (or deliver it as input to
 * whatever process owns the pane — same semantics as tmux `send-keys -l`).
 */
export function sendCommand(surface: string, command: string): void {
  herdrSync(["pane", "send-text", surface, command], "send-text");
  herdrSync(["pane", "send-keys", surface, "Enter"], "send-keys");
}

/**
 * Read the screen contents of a pane (sync).
 */
export function readScreen(surface: string, lines = 50): string {
  return readPaneTextSync(surface, lines);
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  return readPaneTextAsync(surface, lines);
}

/**
 * Close a pane. A subagent pane may already be gone (herdr reaps panes whose
 * session dies), so a missing pane is not an error.
 */
export function closeSurface(surface: string): void {
  try {
    herdrSync(["pane", "close", surface], "pane close");
  } catch {
    // Already closed.
  }
}
