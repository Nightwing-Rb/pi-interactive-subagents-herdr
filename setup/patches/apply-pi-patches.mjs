/**
 * Re-apply this machine's cosmetic pi tweaks on a fresh install.
 *
 * Pinned to the exact source strings of pi 1.4.0 (the version this setup was
 * captured on). Every patch is an exact string replacement with:
 *   - a sanity marker (detects "pi was updated" instead of corrupting files),
 *   - a one-time `.bak-orig` backup,
 *   - idempotent behavior (re-running reports "already").
 *
 * Patches:
 *   1. pi dist: compact `[Extensions]` startup header (names only)
 *   2. pi dist: hide `/bug` and `/changelog` from the `/` menu
 *   3. pi-compact-tools: clearer `compact-tools` / `silent` descriptions
 *
 * Usage:  node setup/patches/apply-pi-patches.mjs
 * Env:    PI_CODING_AGENT_DIR  override agent dir (default ~/.pi/agent)
 *         PI_PATCH_ROOT        override pi package root (testing)
 *
 * Note: `pi update self` / a pi version upgrade replaces the dist and reverts
 * patches 1-2; re-run this script afterwards (it will tell you if the pinned
 * strings no longer exist).
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

function findPiRoot() {
  if (process.env.PI_PATCH_ROOT) return process.env.PI_PATCH_ROOT;
  const releases = join(agentDir, "install", "releases");
  if (!existsSync(releases)) return undefined;
  const candidates = readdirSync(releases)
    .filter((d) => existsSync(join(releases, d, "node_modules", "@earendil-works", "pi-coding-agent", "dist")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (candidates.length === 0) return undefined;
  return join(releases, candidates[candidates.length - 1], "node_modules", "@earendil-works", "pi-coding-agent");
}

const piRoot = findPiRoot();

/** Chunks are content-hashed; locate the right one by marker instead of name. */
function findPiChunk() {
  if (!piRoot) return undefined;
  const dir = join(piRoot, "dist", "bundle", "chunks");
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, f))
    .find((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes('BUILTIN_SLASH_COMMANDS=[{name:"settings"') && src.includes("getCompactExtensionLabel(");
    });
}

const compactToolsDir = join(agentDir, "npm", "node_modules", "pi-compact-tools", "extensions");

/** Each patch: unique `find` → `replace`, plus a `sanity` marker that must exist. */
const PATCHES = [
  // ── 1. hide /bug and /changelog from the `/` menu ────────────────────────
  {
    where: "pi core: slash command list",
    file: () => (piRoot ? join(piRoot, "dist", "core", "slash-commands.js") : undefined),
    sanity: "export const BUILTIN_SLASH_COMMANDS = [",
    find: '    { name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },\n',
    replace: "",
  },
  {
    where: "pi core: slash command list",
    file: () => (piRoot ? join(piRoot, "dist", "core", "slash-commands.js") : undefined),
    sanity: 'name: "copy", description: "Copy last agent message to clipboard"',
    find: '    { name: "changelog", description: "Show changelog entries" },\n',
    replace: "",
  },
  // ── 2. same list, bundled copy in the TUI chunk ──────────────────────────
  {
    where: "pi chunk: slash command list (/bug)",
    file: findPiChunk,
    sanity: 'BUILTIN_SLASH_COMMANDS=[{name:"settings"',
    find: '{name:"share",description:"Share session via a Radius artifact or a GitHub gist"},{name:"bug",description:"Report a bug to the Pi developers",argumentHint:"<description>"},{name:"copy",description:"Copy last agent message to clipboard"},',
    replace: '{name:"share",description:"Share session via a Radius artifact or a GitHub gist"},{name:"copy",description:"Copy last agent message to clipboard"},',
  },
  {
    where: "pi chunk: slash command list (/changelog)",
    file: findPiChunk,
    sanity: '{name:"copy",description:"Copy last agent message to clipboard"}',
    find: '{name:"session",description:"Show session info and stats"},{name:"changelog",description:"Show changelog entries"},{name:"hotkeys",description:"Show all keyboard shortcuts"},',
    replace: '{name:"session",description:"Show session info and stats"},{name:"hotkeys",description:"Show all keyboard shortcuts"},',
  },
  // ── 3. compact [Extensions] header: git package → repo name ──────────────
  {
    where: "pi interactive-mode: compact header (git label)",
    file: () => (piRoot ? join(piRoot, "dist", "modes", "interactive", "interactive-mode.js") : undefined),
    sanity: "getCompactExtensionLabels(extensions)",
    find:
      '        const gitSource = parseGitUrl(source);\n' +
      '        if (gitSource) {\n' +
      '            return gitSource.path || source;\n' +
      '        }\n' +
      '        return source;',
    replace:
      '        const gitSource = parseGitUrl(source);\n' +
      '        if (gitSource) {\n' +
      '            // Compact header: repo name only (drop owner and ref).\n' +
      '            return (gitSource.path ?? "").split("/").pop() || source;\n' +
      '        }\n' +
      '        return source;',
  },
  // ── 4. compact header: package name only (drop :file path) ───────────────
  {
    where: "pi interactive-mode: compact header (package label)",
    file: () => (piRoot ? join(piRoot, "dist", "modes", "interactive", "interactive-mode.js") : undefined),
    sanity: "getCompactNonPackageExtensionLabel(",
    find:
      '        const shortPath = this.getShortPath(resourcePath, sourceInfo).replace(/\\\\/g, "/");\n' +
      '        const packagePath = shortPath.startsWith("extensions/") ? shortPath.slice("extensions/".length) : shortPath;\n' +
      '        const parsedPath = path.posix.parse(packagePath);\n' +
      '        if (parsedPath.name === "index") {\n' +
      '            return !parsedPath.dir || parsedPath.dir === "." ? sourceLabel : `${sourceLabel}:${parsedPath.dir}`;\n' +
      '        }\n' +
      '        return `${sourceLabel}:${packagePath}`;\n' +
      '    }',
    replace: '        // Compact header: package name only — no file path inside the package.\n        return sourceLabel;\n    }',
  },
  // ── 5. compact header: strip .ts/.js + dedupe labels ─────────────────────
  {
    where: "pi interactive-mode: compact header (strip+dedupe)",
    file: () => (piRoot ? join(piRoot, "dist", "modes", "interactive", "interactive-mode.js") : undefined),
    sanity: "getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions)",
    find:
      '        return extensions.map((extension) => {\n' +
      '            if (this.isPackageSource(extension.sourceInfo)) {\n' +
      '                return this.getCompactExtensionLabel(extension.path, extension.sourceInfo);\n' +
      '            }\n' +
      '            const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);\n' +
      '            if (nonPackageIndex === -1) {\n' +
      '                return this.getCompactPathLabel(extension.path, extension.sourceInfo);\n' +
      '            }\n' +
      '            return this.getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);\n' +
      '        });\n' +
      '    }',
    replace:
      '        const labels = extensions.map((extension) => {\n' +
      '            if (this.isPackageSource(extension.sourceInfo)) {\n' +
      '                return this.getCompactExtensionLabel(extension.path, extension.sourceInfo);\n' +
      '            }\n' +
      '            const nonPackageIndex = nonPackageExtensions.findIndex((item) => item.path === extension.path);\n' +
      '            if (nonPackageIndex === -1) {\n' +
      '                return this.getCompactPathLabel(extension.path, extension.sourceInfo);\n' +
      '            }\n' +
      '            return this.getCompactNonPackageExtensionLabel(extension.path, nonPackageIndex, nonPackageExtensions);\n' +
      '        });\n' +
      '        // Compact header: names only — strip .ts/.js suffixes and dedupe\n' +
      '        // (several files from one package now share the package name label).\n' +
      '        return [...new Set(labels.map((label) => label.replace(/\\.(ts|js)$/, "")))];\n' +
      '    }',
  },
  // ── 6-7. compact header, bundled copy of the same functions in the chunk ─
  {
    where: "pi chunk: compact header (git label)",
    file: findPiChunk,
    sanity: "getCompactPackageSourceLabel(sourceInfo)",
    find: 'let gitSource=parseGitUrl(source);return gitSource&&gitSource.path||source}',
    replace: 'let gitSource=parseGitUrl(source);return gitSource&&(gitSource.path??"").split("/").pop()||source}',
  },
  {
    where: "pi chunk: compact header (package label)",
    file: findPiChunk,
    sanity: "getCompactExtensionLabel(resourcePath,sourceInfo)",
    find:
      ';let shortPath=this.getShortPath(resourcePath,sourceInfo).replace(/\\\\/g,"/"),' +
      'packagePath=shortPath.startsWith("extensions/")?shortPath.slice(11):shortPath,parsedPath=path9.posix.parse(packagePath);' +
      'return parsedPath.name==="index"?!parsedPath.dir||parsedPath.dir==="."?sourceLabel:' +
      '`${sourceLabel}:${parsedPath.dir}`:`${sourceLabel}:${packagePath}`}',
    replace: ";return sourceLabel}",
  },
  {
    where: "pi chunk: compact header (strip+dedupe)",
    file: findPiChunk,
    sanity: "getCompactNonPackageExtensionLabel(extension.path,nonPackageIndex,nonPackageExtensions)",
    find:
      'return extensions.map(extension=>{if(this.isPackageSource(extension.sourceInfo))' +
      'return this.getCompactExtensionLabel(extension.path,extension.sourceInfo);' +
      'let nonPackageIndex=nonPackageExtensions.findIndex(item=>item.path===extension.path);' +
      'return nonPackageIndex===-1?this.getCompactPathLabel(extension.path,extension.sourceInfo):' +
      'this.getCompactNonPackageExtensionLabel(extension.path,nonPackageIndex,nonPackageExtensions)})}getDisplaySourceInfo',
    replace:
      'let labels=extensions.map(extension=>{if(this.isPackageSource(extension.sourceInfo))' +
      'return this.getCompactExtensionLabel(extension.path,extension.sourceInfo);' +
      'let nonPackageIndex=nonPackageExtensions.findIndex(item=>item.path===extension.path);' +
      'return nonPackageIndex===-1?this.getCompactPathLabel(extension.path,extension.sourceInfo):' +
      'this.getCompactNonPackageExtensionLabel(extension.path,nonPackageIndex,nonPackageExtensions)});' +
      'return[...new Set(labels.map(label=>label.replace(/\\.(ts|js)$/,"")))]}getDisplaySourceInfo',
  },
  // ── 8. pi-compact-tools: clearer command descriptions ────────────────────
  {
    where: "pi-compact-tools: /silent description",
    file: () => join(compactToolsDir, "compact-tools-silent.ts"),
    sanity: 'registerCommand("silent"',
    find: "description: `(${SILENT_SHORTCUT}) Show only prompts and final answers`,",
    replace:
      "description: `(${SILENT_SHORTCUT}) Hide tool/thinking rows — show only prompts and final answers`,",
  },
  {
    where: "pi-compact-tools: /compact-tools description",
    file: () => join(compactToolsDir, "compact-tools-command.ts"),
    sanity: 'registerCommand("compact-tools"',
    find: 'description: "Choose compact/Claude/Codex/default tool rows, or show settings and controls",',
    replace: 'description: "Choose tool-row style: compact, Claude, Codex, default — plus status, help",',
  },
];

function runPatch(patch) {
  const target = patch.file();
  if (!target || !existsSync(target)) return { status: "no-file" };
  const src = readFileSync(target, "utf8");
  if (!src.includes(patch.sanity)) return { status: "missing", why: "sanity marker not found (pi changed?)" };
  if (!src.includes(patch.find)) {
    // find gone: applied if the replacement is in place (or, for removals, if sanity still holds)
    return { status: "already" };
  }
  const occurrences = src.split(patch.find).length - 1;
  if (occurrences !== 1) return { status: "missing", why: `found ${occurrences} matches, expected 1` };
  const backup = `${target}.bak-orig`;
  if (!existsSync(backup)) copyFileSync(target, backup);
  writeFileSync(target, src.split(patch.find).join(patch.replace), "utf8");
  return { status: "applied" };
}

console.log("pi cosmetic patches");
console.log(`  agent dir: ${agentDir}`);
console.log(`  pi root:   ${piRoot ?? "NOT FOUND"}`);
let applied = 0,
  already = 0,
  failed = 0;
for (const patch of PATCHES) {
  const { status, why } = runPatch(patch);
  if (status === "applied") applied++;
  else if (status === "already") already++;
  else failed++;
  const icon = status === "applied" ? "+" : status === "already" ? "=" : "!";
  const suffix = why ? ` (${why})` : "";
  console.log(`  ${icon} ${status.padEnd(8)} ${patch.where}${suffix}`);
}
console.log(`\n${applied} applied, ${already} already, ${failed} not found`);
if (failed > 0) {
  console.log(
    "\n'not found' usually means pi was updated past the pinned 1.4.0 strings —" +
      "\nthe tweaks were already reverted/never present; review before forcing anything.",
  );
}
process.exit(failed > 0 ? 1 : 0);
