import {
  isHerdrAvailable,
  currentPaneId,
} from "./pi-extension/subagents/herdr.ts";
import {
  isMuxAvailable,
  muxSetupHint,
  createSurface,
  sendCommand,
  sendLongCommand,
  readScreen,
  closeSurface,
  pollForExit,
} from "./pi-extension/subagents/tmux.ts";

console.log("herdr available:", isHerdrAvailable());
console.log("parent pane:", currentPaneId());
console.log("mux available:", isMuxAvailable(), "| hint:", muxSetupHint());

console.log("spawning surface...");
const surface = createSurface("test-agent");
console.log("spawned surface:", surface);

sendCommand(surface, "echo '__SUBAGENT_DONE_'$?'__'");
await new Promise((r) => setTimeout(r, 1500));
const screen = readScreen(surface, 20);
console.log("screen:", JSON.stringify(screen.slice(-300)));
console.log("sentinel found:", /__SUBAGENT_DONE_\d+__/.test(screen));

const scriptPath = sendLongCommand(surface, `echo LONG_CMD_OK > /c/Users/Admin/probe-longcmd.txt`);
console.log("script:", scriptPath);
await new Promise((r) => setTimeout(r, 2500));
console.log("longcmd echoed on screen:", readScreen(surface, 15).includes("LONG_CMD_OK"));

console.log("polling for exit sentinel...");
const res = await pollForExit(surface, new AbortController().signal, {
  interval: 300,
  onTick: () => {},
});
console.log("pollForExit:", JSON.stringify(res));

closeSurface(surface);
console.log("closed surface");
