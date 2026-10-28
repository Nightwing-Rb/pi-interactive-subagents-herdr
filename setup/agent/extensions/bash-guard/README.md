# bash-guard (pi extension)

Intercepts agent-issued `bash` tool calls and applies different protection depending on whether
the session is interactive (main session) or non-interactive (spawned subagent).

Before matching, commands are **normalized**: line continuations are joined, comments stripped
(POSIX word-start semantics), backslash escapes removed, quote marks dropped, and shell
separators inside quoted spans neutralized. This defeats common disguises (`"rm" -rf`,
`r\m -rf`, `rm file#1 -rf`, `sh -c "rm -rf x"`) without flagging quoted prose
(`rg "reboot" docs`, `grep -E '(halt|poweroff)' logs`).

## Modes

Behaviour is determined per tool call by whether the session runs inside a spawned subagent.
Two marker styles are recognized because neither is universal:

- `PI_SUBAGENT_DEPTH` ≥ 1 (other subagent frameworks; a non-numeric value fails closed)
- `PI_SUBAGENT_NAME` / `PI_SUBAGENT_SESSION` / `PI_SUBAGENT_AGENT` (injected by pi-subagents/herdr)

### Main session — interactive prompt

- Heuristically detects destructive/questionable commands via shell-aware parsing, with the
  hard-block list below as a floor (wrapper commands like `timeout rm -rf`, `FOO=1 rm -rf`,
  `sh -c 'rm -rf x'` can never slip through silently)
- Prompts for **any** `git ...` command (escalates severity for especially risky ones: `git rm`,
  `git reset --hard`, `git clean -fdx`, `git push --force`, `git reflog expire`, `git gc --prune`)
- Prompts for disk/volume tooling: `diskutil`, `hdiutil`, `mkfs*`, `newfs_*`, `wipefs`, `parted`,
  `fdisk`, `gdisk/sgdisk`, `cryptsetup`, `pvcreate/vgcreate/lvcreate`, `zpool`, `lsblk`
- Prompts for: `rm`/`rmdir`/`unlink`, `sudo`, `find -delete`, `dd`, `truncate`, `sed -i`,
  `perl -pi`, `chmod/chown -R`, `mv/cp --force`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`,
  `systemctl stop/disable`, `curl|sh`/`wget|sh`, `kubectl delete`, `terraform destroy`,
  `aws s3 rm --recursive`, `gcloud delete`, shell redirections (`>`, `>>`), pipes
- Shows a Run / Abort dialog in the TUI; RPC sessions get a `ctx.ui.confirm` dialog instead;
  JSON/print modes fail closed (with `--bash-guard-auto-allow` as an explicit opt-out)
- If aborted, the tool call is blocked and the model receives a clear reason
- Remembers recently aborted commands for 60 s to prevent retry loops (no-UI aborts do not
  poison the memory; expired entries are pruned)

### Subagent — headless hard-block

Spawned subagents have no UI (stdin is `/dev/null`), so prompting is impossible. Instead,
a focused set of catastrophic/unrecoverable operations is hard-blocked with no user interaction.
Patterns are anchored to **command position** (start of input or after `;`, `&&`, `||`, `|`,
newlines, etc., through wrappers like `sudo`/`timeout`/`xargs`/`sh -c`, with optional path
prefixes), so words in arguments never trigger blocks.

| Pattern | Reason |
|---|---|
| `rm -r` / `-rf` / `-Rf` (incl. via wrappers, `xargs`, quoting/escapes) | Recursive deletion |
| `Remove-Item`/`del`/`ri`/`rd` with `-Recurse`/`-Force` or `/s`, `del /s` | Recursive/bulk deletion (Windows) |
| `find -delete`, `find -exec rm/sh/sudo` | Bulk deletion |
| `sudo`, `su`, `doas`, `pkexec` | Elevated privileges |
| `curl\|sh`, `wget\|sh`, `curl\|python -`, `irm\|iex`, `iex (irm …)` | Remote code execution |
| `mkfs*`, `newfs_*` | Filesystem formatting |
| `wipefs` (`--list`/`-n` exempt) | Disk signature wipe |
| `diskutil erase*/delete*`, `Format-Volume`, `Clear-Disk`, `Initialize-Disk` | Destructive disk operation |
| `dd of=/dev/…` (`null`/`std*` exempt), `blkdiscard`, `> /dev/sd…` | Raw disk write |
| `parted`/`fdisk`/`gdisk`/`sgdisk` (print/list invocations exempt) | Partition table management |
| `cryptsetup`, `zpool` (status/list/get/history/iostat exempt) | Disk/encryption management |
| `shutdown`, `reboot`, `halt`, `poweroff`, `init 0/6`, `systemctl poweroff…` | System power operation |
| `Restart-Computer`, `Stop-Computer` | System power operation (Windows) |
| `kill -1` | Kill all processes |
| `terraform`/`tofu destroy`, `kubectl delete`, `aws s3 rm --recursive`, `gsutil rm -r`, `az group delete`, `helm uninstall` | Infrastructure teardown |
| `git push --force`/`-f`/`+refspec` | Force-push |
| `git reset --hard`, `git checkout/restore .` | Discard working tree changes |
| `git clean -f`, `git reflog expire`, `git prune`, `git gc --prune`, `git branch -D` | Delete untracked files / recovery history |

Read-only disk inspection (`fdisk -l`, `zpool status`, `wipefs --list`, `parted … print`) and
routine git operations (`git commit`, `git pull`, plain `git push`, `git status`, …) pass through:
a worker tasked with committing or pulling is not bricked.

## Install

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Run `/reload` in pi.

## Notes

- Scope: `bash` tool calls only (`write`/`edit` and user `!` commands are not intercepted).
- Flags are registered as `bash-guard-auto-allow` and `bash-guard-disabled` and read with bare
  names (`pi.getFlag("bash-guard-disabled")`) — pi stores flag values under the name given at
  registration, without `--` prefixes.
- `--bash-guard-auto-allow`: main-session flag that allows flagged commands when there is no UI
  (e.g. running pi non-interactively). Has no effect in subagent sessions.
- `/bash-guard` toggles the interactive layer for the session; the hard-block floor still applies.
- Hard-block patterns live in `patterns.ts` (pure module, no pi imports) and are unit-tested via
  `node test-patterns.ts`.
- The patterns are a guard against reckless commands, **not an adversarial boundary**. Known
  limitations: generic interpreters (`python -c "shutil.rmtree(...)"`, base64 tricks) bypass
  regex matching; multi-statement inner shells (`sh -c "a; rm -rf b"` — separators inside
  quotes are neutralized to protect quoted prose) and `FOO="a b" rm -rf` (space inside an
  assignment) can slip through; quoted sequences that look like full rule matches
  (e.g. `grep 'git push --force'` after a wrapper-style first word) may prompt spuriously.
