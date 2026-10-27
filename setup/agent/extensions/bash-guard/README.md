# bash-guard (pi extension)

Intercepts agent-issued `bash` tool calls and applies different protection depending on whether
the session is interactive (main session) or non-interactive (spawned subagent).

## Modes

Behaviour is determined at registration time by whether the session runs inside a spawned
subagent. Two marker styles are recognized because neither is universal:

- `PI_SUBAGENT_DEPTH` ≥ 1 (other subagent frameworks)
- `PI_SUBAGENT_NAME` / `PI_SUBAGENT_SESSION` / `PI_SUBAGENT_AGENT` (injected by pi-subagents/herdr)

### Main session (`PI_SUBAGENT_DEPTH` = 0 or unset) — interactive prompt

- Heuristically detects destructive/questionable commands via shell-aware parsing
- Prompts for **any** `git ...` command (escalates severity for especially risky ones: `git rm`,
  `git reset --hard`, `git clean -fdx`, `git push --force`, `git reflog expire`, `git gc --prune`)
- Prompts for disk/volume tooling: `diskutil`, `hdiutil`, `mkfs*`, `newfs_*`, `wipefs`, `parted`,
  `fdisk`, `gdisk/sgdisk`, `cryptsetup`, `pvcreate/vgcreate/lvcreate`, `zpool`, `lsblk`
- Prompts for: `rm`/`rmdir`/`unlink`, `sudo`, `find -delete`, `dd`, `truncate`, `sed -i`,
  `perl -pi`, `chmod/chown -R`, `mv/cp --force`, `kill`/`pkill`/`killall`, `shutdown`/`reboot`,
  `systemctl stop/disable`, `curl|sh`/`wget|sh`, `kubectl delete`, `terraform destroy`,
  `aws s3 rm --recursive`, `gcloud delete`, shell redirections (`>`, `>>`, `2>`), pipes
- Shows a 2-option dialog: **Run** / **Abort**
- If aborted, the tool call is blocked and the model receives a clear reason
- Remembers recently aborted commands for 60 s to prevent retry loops

### Subagent (`PI_SUBAGENT_DEPTH` ≥ 1) — headless hard-block

Spawned subagents have no UI (stdin is `/dev/null`), so prompting is impossible. Instead,
a focused set of catastrophic/unrecoverable operations is hard-blocked with no user interaction.
All patterns are anchored to **command position** (start of input or after `;`, `&&`, `||`, `|`,
newlines, etc.), so words appearing in arguments or search terms do not trigger blocks:
`rg "reboot" docs` and `grep halt error.log` pass.

| Pattern | Reason |
|---|---|
| `rm -r` / `-rf` / `-Rf` (incl. via `xargs`, env wrappers) | Recursive deletion |
| `Remove-Item -Recurse/-Force`, `rd /s`, `del /s` | Recursive/bulk deletion (Windows) |
| `sudo` | Elevated privileges |
| `curl\|sh`, `wget\|sh` | Pipe to shell (remote code execution) |
| `iex` / `Invoke-Expression`, `irm\|iex` | PowerShell remote code execution |
| `mkfs*`, `newfs_*` | Filesystem formatting |
| `wipefs` | Disk signature wipe |
| `diskutil erase/zeroDisk/secureErase/reformat` | Destructive disk operation |
| `Format-Volume`, `Clear-Disk`, `Initialize-Disk` | Destructive disk operation (Windows) |
| `dd of=/dev/…` | Raw disk write |
| `parted`, `fdisk`, `gdisk`, `sgdisk` | Partition table management |
| `cryptsetup` | Disk encryption management |
| `zpool` | ZFS pool management |
| `shutdown`, `reboot`, `halt`, `poweroff` | System power operation |
| `Restart-Computer`, `Stop-Computer` | System power operation (Windows) |
| `terraform destroy` | Infrastructure teardown |
| `kubectl delete` | Kubernetes resource deletion |
| `aws s3 rm --recursive` | Bulk S3 deletion |
| `git push --force` / `-f` | Force-push (rewrites remote history) |
| `git reset --hard` | Discard all uncommitted changes |
| `git clean -f` | Delete untracked files |
| `git reflog expire` | Remove recovery history |
| `git gc --prune` | Prune unreachable objects |

All other commands pass through unaffected — including **routine git operations**
(`git commit`, `git pull`, plain `git push`, `git status`, …): a worker tasked with
committing or pulling is not bricked; only destructive git operations are blocked.

## Install

Auto-discovered from `~/.pi/agent/extensions/bash-guard/`. Run `/reload` in pi.

## Notes

- Scope: `bash` tool calls only (`write`/`edit` and user `!` commands are not intercepted).
- `--bash-guard-auto-allow`: main-session flag that allows flagged commands when there is no UI
  (e.g. running pi non-interactively). Has no effect in subagent sessions.
- Hard-block patterns live in `patterns.ts` (pure module, no pi imports) and are unit-tested via
  `node test-patterns.ts`.
- The patterns are a guard against reckless commands, **not an adversarial boundary**: nested or
  encoded payloads (`bash -c 'rm -rf x'`, `python -c "shutil.rmtree(...)"`, base64 tricks) can
  bypass regex matching.
