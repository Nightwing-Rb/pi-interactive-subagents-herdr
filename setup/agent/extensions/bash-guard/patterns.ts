// bash-guard hard-block patterns (pure, no pi imports — unit-testable via test-patterns.ts).
//
// All patterns are anchored to *command position* (see CMD_POS) so that words merely
// appearing in arguments, search terms, or quoted text do not trigger blocks:
//   `rg "reboot" docs/`, `grep halt error.log`, `echo "rm -rf /"` all pass.
// This is a guard against reckless commands, NOT an adversarial boundary: encoded or
// nested payloads (`bash -c 'rm -rf x'`, `python -c ...`, base64 tricks) can bypass it.

// Command position: start of input, or after a shell separator ( ; && || | & newline,
// subshell/brace/command-substitution open). Common wrappers are skipped so that
// `sudo rm -rf`, `xargs rm -rf`, `FOO=1 rm -rf`, `\rm -rf`, `then rm -rf` still match.
export const CMD_POS =
	"(?:^|[;&|(`{\\n])\\s*(?:(?:sudo|env|command|exec|nohup|time|nice|then|do|else)\\s+" +
	"|xargs\\s+(?:-\\S+\\s+)*|[A-Za-z_][\\w-]*=\\S+\\s+|\\\\)*";

// Hard-block patterns for subagent (headless) mode. Criteria: unrecoverable by default AND
// unlikely to be intentional in an automated context. Fewer false positives over broad coverage —
// the interactive prompt handles the rest for main sessions.
export const HEADLESS_BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
	// Recursive deletion (POSIX)
	{ pattern: new RegExp(CMD_POS + String.raw`rm\b[^#\n]*\s-(?:[a-zA-Z]*[rR]|-\brecursive\b)`), reason: "recursive delete (rm -r / -rf / -Rf)" },
	// Recursive/forced deletion (Windows / PowerShell)
	{ pattern: new RegExp(CMD_POS + String.raw`Remove-Item\b[^#\n]*(?:-Recurse\b|-r\b|-Force\b|-f\b)`, "i"), reason: "recursive/forced deletion (Remove-Item)" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:rd|rmdir)\b[^#\n]*/[sS]`), reason: "recursive delete (rd /s / rmdir /s)" },
	{ pattern: new RegExp(CMD_POS + String.raw`del\b[^#\n]*/[sS]`), reason: "bulk delete (del /s)" },
	// Privilege escalation
	{ pattern: new RegExp(CMD_POS + String.raw`sudo\b`), reason: "elevated privileges (sudo)" },
	// Remote code execution via pipe-to-shell (POSIX + PowerShell)
	{ pattern: new RegExp(CMD_POS + String.raw`(?:curl|wget)\b[^#\n]*\|\s*(?:ba?sh|zsh|fish|dash|sh)\b`), reason: "pipe to shell (remote code execution)" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:iex|Invoke-Expression)\b`, "i"), reason: "PowerShell Invoke-Expression (remote code execution)" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:Invoke-WebRequest|iwr|irm|curl|wget)\b[^#\n]*\|\s*(?:iex|Invoke-Expression)\b`, "i"), reason: "download piped to Invoke-Expression (remote code execution)" },
	// Disk / filesystem destruction
	{ pattern: new RegExp(CMD_POS + String.raw`mkfs\w*`), reason: "filesystem formatting (mkfs*)" },
	{ pattern: new RegExp(CMD_POS + String.raw`newfs_\w+`), reason: "filesystem formatting (newfs_*)" },
	{ pattern: new RegExp(CMD_POS + String.raw`wipefs\b`), reason: "disk signature wipe" },
	{ pattern: new RegExp(CMD_POS + String.raw`diskutil\s+(?:erase\w*|zeroDisk|secureErase|reformat)\b`, "i"), reason: "destructive disk operation (diskutil)" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:Format-Volume|Clear-Disk|Initialize-Disk)\b`, "i"), reason: "destructive disk operation (Windows)" },
	{ pattern: new RegExp(CMD_POS + String.raw`dd\b[^#\n]*\bof=\/dev\/`), reason: "raw disk write (dd of=/dev/...)" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:parted|fdisk|gdisk|sgdisk)\b`), reason: "partition table management" },
	{ pattern: new RegExp(CMD_POS + String.raw`cryptsetup\b`), reason: "disk encryption management" },
	{ pattern: new RegExp(CMD_POS + String.raw`zpool\b`), reason: "ZFS pool management" },
	// System power
	{ pattern: new RegExp(CMD_POS + String.raw`(?:shutdown|reboot|halt|poweroff)\b`), reason: "system power operation" },
	{ pattern: new RegExp(CMD_POS + String.raw`(?:Restart-Computer|Stop-Computer)\b`, "i"), reason: "system power operation (PowerShell)" },
	// Infrastructure teardown
	{ pattern: new RegExp(CMD_POS + String.raw`terraform\s+destroy\b`), reason: "infrastructure teardown (terraform destroy)" },
	{ pattern: new RegExp(CMD_POS + String.raw`kubectl\s+delete\b`), reason: "Kubernetes resource deletion" },
	{ pattern: new RegExp(CMD_POS + String.raw`aws\s+s3\s+rm\b[^#\n]*--recursive`), reason: "bulk S3 deletion (aws s3 rm --recursive)" },
	// Destructive git operations. Plain `git commit` / `git pull` / `git push` are
	// allowed: a worker tasked with committing or pulling should not be bricked.
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+push\b[^#\n]*(?:--force\b|\s-f\b)`), reason: "force-push (git push --force/-f)" },
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+reset\b[^#\n]*--hard\b`), reason: "discard all uncommitted changes (git reset --hard)" },
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+clean\b[^#\n]*-[a-zA-Z]*f`), reason: "delete untracked files (git clean -f)" },
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+reflog\s+expire\b`), reason: "expire reflog (removes recovery history)" },
	{ pattern: new RegExp(CMD_POS + String.raw`git\s+gc\b[^#\n]*--prune\b`), reason: "prune unreachable objects (git gc --prune)" },
];

// Hard-block floor used when bash-guard is disabled in an interactive (main) session.
// The user explicitly opts into autonomy here; with plain git commit/pull/push no longer
// part of the blocklist, the disabled-mode floor is identical to the subagent blocklist.
export const MAIN_DISABLED_BLOCKED: Array<{ pattern: RegExp; reason: string }> = HEADLESS_BLOCKED;
