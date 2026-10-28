// bash-guard hard-block patterns (pure, no pi imports — unit-testable via test-patterns.ts).
//
// Matching happens against a NORMALIZED command (see normalizeCommand): line continuations
// are joined, comments stripped, backslash escapes removed, quote marks dropped, and shell
// separators inside quoted spans neutralized. This defeats common disguises (`"rm" -rf`,
// `r\m -rf`, `rm file#1 -rf`, `sh -c "rm -rf x"`) without flagging quoted prose
// (`rg "reboot" docs`, `grep -E '(halt|poweroff)' logs`).
//
// All patterns are additionally anchored to *command position* (see CMD_POS) so words
// appearing in arguments do not trigger blocks. This is a guard against reckless commands,
// NOT an adversarial boundary: encoded or generic-interpreter payloads (base64 tricks,
// `python -c "shutil.rmtree(...)"`) can still bypass it.

// Characters that act as shell separators. Inside quoted spans these are replaced by
// spaces during normalization, so quoted regexes like `(halt|rm)` cannot fake command
// positions; outside quotes they remain separators for CMD_POS.
const QUOTE_SEPARATORS = ";|&()<>`{}\n\r!";

export function normalizeCommand(command: string): string {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote) {
			if (c === "\\" && quote === '"') {
				const n = command[++i];
				if (n === undefined) break;
				out += QUOTE_SEPARATORS.includes(n) ? " " : n;
				continue;
			}
			if (c === quote) {
				quote = null;
				continue;
			}
			out += QUOTE_SEPARATORS.includes(c) ? " " : c;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			continue;
		}
		if (c === "\\") {
			const n = command[i + 1];
			if (n === undefined) {
				out += c;
				continue;
			}
			if (n === "\n" || (n === "\r" && command[i + 2] === "\n")) {
				out += " ";
				i += n === "\n" ? 1 : 2;
				continue;
			}
			out += n;
			i += 1;
			continue;
		}
		if (c === "#") {
			const prev = out.length ? out[out.length - 1] : "";
			if (prev === "" || /[\s;|&(!]/.test(prev)) {
				// Comment: skip to end of line (POSIX only starts comments at word start).
				while (i < command.length && command[i] !== "\n") i++;
				continue;
			}
		}
		out += c;
	}
	return out.replace(/[ \t]+/g, " ");
}

// Command position: start of input, or after a shell separator ( ; && || | & newline,
// subshell/brace/command-substitution open, `!` negation). Common wrappers are skipped —
// each may take its own flags/args — so `sudo rm -rf`, `timeout 5 rm -rf`, `env -i rm -rf`,
// `xargs -n 1 rm -rf`, `sh -c rm -rf`, `then rm -rf` all still match, while `echo rm -rf`
// and `rg reboot docs` do not. An optional path prefix covers `/sbin/reboot`, `./bin/rm`.
const WRAPPER_ARGS = "(?:(?:[-/]\\S+|\\d+)\\s+)*";
const WRAPPERS =
	"sudo|env|command|exec|nohup|time|nice|then|do|else|elif|if|while|until|timeout|stdbuf|" +
	"ionice|chroot|unshare|setsid|busybox|powershell|pwsh|cmd|bash|sh|zsh|dash|ksh|python3?|node|perl|ruby";
export const CMD_POS =
	"(?:^|[;&|(`{!\\n])\\s*" +
	"(?:" +
	`(?:${WRAPPERS})\\s+${WRAPPER_ARGS}` +
	"|xargs\\s+(?:\\S+\\s+)*" +
	"|[A-Za-z_][\\w-]*=\\S+\\s+" +
	"|\\\\" +
	")*" +
	"(?:/?[\\w.+-]+/)*";

const R = (src: string) => new RegExp(CMD_POS + src, "i");

// Hard-block patterns for subagent (headless) mode. Criteria: unrecoverable by default AND
// unlikely to be intentional in an automated context. Fewer false positives over broad
// coverage — the interactive prompt handles the rest for main sessions.
export const HEADLESS_BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
	// --- Recursive/forced deletion (POSIX). A dash-token that is letter-only and contains
	// `r` is a short-flag cluster (`-rf`, `-Rf`, `-fr`); tokens with internal dashes
	// (`-- -weird-file` operands) do not match. `#` may appear mid-word (comments are
	// stripped earlier), hence `[^\n]*` rather than `[^#\n]*`.
	{ pattern: R(String.raw`rm\b[^\n]*\s-(?:[a-zA-Z]*r[a-zA-Z]*(?=\s|$)|-\s*recursive\b)`), reason: "recursive delete (rm -r / -rf / -Rf)" },
	// --- Recursive/forced deletion (Windows / PowerShell): `/s` must be a standalone
	// switch (paths like `/srv/...` or `./scripts/...` must not match), or a PS-style
	// flag. Covers Remove-Item and its aliases del/erase/ri plus cmd's rd/rmdir.
	{ pattern: R(String.raw`(?:remove-item|del|erase|ri|rd|rmdir)\b[^\n]*?\s(?:/[sS](?=\s|$)|-(?:recurse|force|r|f)\b)`), reason: "recursive/forced deletion (Remove-Item / rd /s / del /s)" },
	// --- Bulk deletion via find
	{ pattern: R(String.raw`find\b[^\n]*\s-delete\b`), reason: "find -delete (bulk deletion)" },
	{ pattern: R(String.raw`find\b[^\n]*-exec(?:dir)?\s+(?:/?[\w.+-]+/)*(?:rm|rmdir|rd|del|sh|bash|zsh|sudo)\b`), reason: "find -exec of a destructive/shell command" },
	// --- Privilege escalation
	{ pattern: R(String.raw`(?:sudo|doas|pkexec)\b`), reason: "elevated privileges" },
	{ pattern: R(String.raw`su\b`), reason: "privilege escalation (su)" },
	// --- Remote code execution via pipe-to-shell (POSIX + PowerShell). Receiver may take
	// a path prefix or an env/command wrapper (`| env sh`), and `|&` counts as a pipe.
	{ pattern: R(String.raw`(?:curl|wget)\b[^\n]*\|&?\s*(?:(?:env|command)\s+)*(?:/?[\w.+-]+/)*(?:sh|bash|zsh|fish|dash|csh|tcsh|ksh)\b`), reason: "pipe to shell (remote code execution)" },
	{ pattern: R(String.raw`(?:curl|wget)\b[^\n]*\|&?\s*(?:python3?|node|perl|ruby|pwsh|powershell)\s+-`), reason: "download piped to an interpreter (remote code execution)" },
	{ pattern: R(String.raw`(?:invoke-webrequest|iwr|irm|curl|wget)\b[^\n]*\|&?\s*(?:iex|invoke-expression)\b`), reason: "download piped to Invoke-Expression (remote code execution)" },
	// `iex` is also the Elixir REPL (`iex -S mix`) — only flag it with a non-flag argument.
	{ pattern: R(String.raw`(?:iex\s+(?!-)|invoke-expression\b)`), reason: "PowerShell Invoke-Expression (remote code execution)" },
	// --- Disk / filesystem destruction. Read-only invocations are exempted where common
	// (fdisk -l, zpool status, wipefs --list, parted/sgdisk print).
	{ pattern: R(String.raw`mkfs\w*`), reason: "filesystem formatting (mkfs*)" },
	{ pattern: R(String.raw`newfs_\w+`), reason: "filesystem formatting (newfs_*)" },
	{ pattern: R(String.raw`wipefs\b(?!\s+(?:--list\b|-n\b))`), reason: "disk signature wipe" },
	{ pattern: R(String.raw`diskutil\s+(?:(?:apfs|corestorage)\s+)?(?:delete\w*|erase\w*|zerodisk|secureerase|reformat)\b`), reason: "destructive disk operation (diskutil)" },
	{ pattern: R(String.raw`(?:format-volume|clear-disk|initialize-disk)\b`), reason: "destructive disk operation (Windows)" },
	{ pattern: R(String.raw`dd\b[^\n]*\bof=/*dev/(?!null\b|stdout\b|stdin\b|stderr\b)`), reason: "raw disk write (dd of=/dev/...)" },
	{ pattern: R(String.raw`parted\b(?![^\n]*\bprint\b)`), reason: "partition table management" },
	{ pattern: R(String.raw`fdisk\s+(?!-l\b|-lu\b|--list\b)`), reason: "partition table management" },
	{ pattern: R(String.raw`sgdisk\s+(?!-\S*[pP]\b|--print\b)`), reason: "partition table management" },
	{ pattern: R(String.raw`(?:gdisk)\b`), reason: "partition table management" },
	{ pattern: R(String.raw`cryptsetup\b`), reason: "disk encryption management" },
	{ pattern: R(String.raw`zpool\s+(?!status\b|list\b|get\b|history\b|iostat\b|upgrade\b)`), reason: "ZFS pool management" },
	{ pattern: R(String.raw`blkdiscard\b`), reason: "block device discard (blkdiscard)" },
	// --- System power
	{ pattern: R(String.raw`(?:shutdown|reboot|halt|poweroff|telinit)\b`), reason: "system power operation" },
	{ pattern: R(String.raw`init\s+[06]\b`), reason: "system power operation (init 0/6)" },
	{ pattern: R(String.raw`systemctl\s+(?:-\S+\s+)*(?:poweroff|reboot|halt|shutdown|isolate\s+[^\n]*?(?:poweroff|reboot))\b`), reason: "system power operation (systemctl)" },
	{ pattern: R(String.raw`(?:restart-computer|stop-computer)\b`), reason: "system power operation (PowerShell)" },
	{ pattern: R(String.raw`(?:kill|pkill)\b[^\n]*\s-1\b`), reason: "kill all processes (kill -1)" },
	// --- Infrastructure teardown. Subcommands tolerate global flags and one positional
	// (e.g. `kubectl -n prod delete`, `terraform -chdir=infra destroy`).
	{ pattern: R(String.raw`(?:terraform|tofu)\s+(?:-\S+\s+)*(?:\S+\s+)?destroy\b`), reason: "infrastructure teardown (terraform destroy)" },
	{ pattern: R(String.raw`kubectl\s+(?:-\S+\s+)*(?:\S+\s+)?delete\b`), reason: "Kubernetes resource deletion" },
	{ pattern: R(String.raw`aws\s+(?:-\S+\s+)*(?:\S+\s+)?s3\s+(?:-\S+\s+)*(?:rm|rb)\b[^\n]*?(?:--recursive\b|--force\b)`), reason: "bulk S3 deletion" },
	{ pattern: R(String.raw`gsutil\s+(?:-\S+\s+)*rm\b[^\n]*\s-r\b`), reason: "bulk GCS deletion (gsutil rm -r)" },
	{ pattern: R(String.raw`az\s+group\s+delete\b`), reason: "Azure resource group deletion" },
	{ pattern: R(String.raw`helm\s+(?:-\S+\s+)*uninstall\b`), reason: "Helm release removal" },
	// --- Destructive git operations. Plain `git commit` / `git pull` / `git push` are
	// allowed: a worker tasked with committing or pulling should not be bricked. The
	// subcommand may be preceded by global flags (`git -C repo ...`) and one positional.
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?push\b[^\n]*?(?:--force\b|\s-f\b|\s\+\S+)`), reason: "force-push (git push --force / -f / +refspec)" },
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?reset\b[^\n]*?--hard\b`), reason: "discard all uncommitted changes (git reset --hard)" },
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?clean\b[^\n]*?-[a-zA-Z]*f`), reason: "delete untracked files (git clean -f)" },
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?(?:reflog\s+expire|prune)\b`), reason: "remove git recovery history" },
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?gc\b[^\n]*?--prune\b`), reason: "prune unreachable objects (git gc --prune)" },
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?branch\b[^\n]*\s-D\b`), reason: "force-delete branch (git branch -D)" },
	{ pattern: R(String.raw`git\s+(?:-\S+\s+)*(?:\S+\s+)?(?:restore|checkout)\b[^\n]*?(?:\s|^)\.\s*(?:$|[;&|)])`), reason: "discard working tree changes (git checkout/restore .)" },
	// --- Redirect onto a raw block device (`> /dev/sda` etc.); /dev/null-style sinks pass.
	// Not command-position anchored: redirections always appear mid-command. The target
	// must be the direct redirect target, so `echo x > out && cat /dev/sda` does not match.
	{ pattern: new RegExp(String.raw`>\s*/*dev/(?:sd|hd|nvme|vd|xvd|disk|mapper|mem|kmem|port)`, "i"), reason: "redirect onto a raw disk device" },
];

// Hard-block floor used when bash-guard is disabled in an interactive (main) session.
// The user explicitly opts into autonomy here; an independent copy of the same rules.
export const MAIN_DISABLED_BLOCKED: Array<{ pattern: RegExp; reason: string }> = [...HEADLESS_BLOCKED];

export function matchBlocked(
	list: Array<{ pattern: RegExp; reason: string }>,
	normalizedCommand: string,
): string | null {
	for (const { pattern, reason } of list) {
		if (pattern.test(normalizedCommand)) return reason;
	}
	return null;
}
