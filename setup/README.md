# Complete pi machine setup

This directory is a full snapshot of this machine's pi configuration (minus
secrets). Clone the repo on a new machine and run the bootstrap to get the
identical setup: same packages, extensions, theme, models, and tool config.

## What's included / excluded

| Included (`setup/agent/` → `~/.pi/agent/`) | Excluded (machine state / secrets) |
|---|---|
| `settings.json` (defaults, theme, packages) | `auth.json` — API keys, **never committed** |
| `extensions/` — ask-user-question, bash-guard, herdr-agent-state, prompt-snippets (+ snippets), whimsical | `sessions/` — conversation history |
| `themes/sapphire-ember.json` | `install/`, `bin/` — pi itself (installer handles it) |
| `models-store.json` (xiaomi/mimo catalog) | `npm/`, `git/` — package checkouts (reinstalled by bootstrap) |
| `compact-tools.json` | |

The subagent extension itself **is this repo** (root: `package.json`,
`pi-extension/`, bundled `agents/`), including all local fixes:
CRLF-tolerant agent parsing, package-backed web tools for subagent children,
`/subagent` completions, and the improved command descriptions.

## New machine in 5 steps

1. **Install pi** (Node ≥ 22.19):

   ```sh
   curl -fsSL https://pi.dev/install.sh | sh
   # or: npm install -g --ignore-scripts @earendil-works/pi-coding-agent
   ```

2. **Requirements for the herdr subagent backend** (this fork): Git for Windows
   (Git bash at `C:\Program Files\Git\bin\bash.exe`) and [herdr](https://herdr.dev)
   — you run pi inside a herdr pane. Plain upstream setups can use tmux instead.

3. **Clone this repo** anywhere:

   ```sh
   git clone https://github.com/Nightwing-Rb/pi-interactive-subagents-herdr.git
   cd pi-interactive-subagents-herdr
   ```

4. **Run the bootstrap** (PowerShell):

   ```powershell
   powershell -ExecutionPolicy Bypass -File setup\bootstrap.ps1
   ```

   It copies `setup/agent/*` into `~/.pi/agent/`, installs the npm packages,
   registers this clone as the subagent extension, and npm-installs
   `bash-guard`'s dependency. Manual equivalent: copy every item in
   `setup/agent/` to `~/.pi/agent/`, then run
   `pi install npm:pi-compact-tools`, `pi install npm:donsetch`, and
   `pi install <path-to-this-clone>`.

5. **Authenticate**: start `pi` and run `/login xiaomi` (add the API key on the
   new machine — credentials are intentionally not part of this repo).

Optional cosmetic patches (pi **1.4.0** only):

```sh
node setup/patches/apply-pi-patches.mjs
```

Applies the same local tweaks this machine runs: compact `[Extensions]`
startup header (names only), `/bug` + `/changelog` hidden from the `/` menu,
and clearer descriptions for the `compact-tools` / `silent` commands. Every
replacement is exact-match with backups; the script reports `already` or
`missing` safely if pi has been updated past the pinned strings.

## After bootstrap

- Restart pi (or `/reload`) — the command menu shows `/subagent` with
  agent-name completions, and the header lists extensions compactly.
- Verify with `pi list` (3 packages) and `/subagent ` (scout / researcher /
  worker hints).
