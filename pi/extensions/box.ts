// Registers box's hosted MCP server with Pi for every session.
// Pi's built-in MCP support (and pi-mcp-adapter, if installed) connects it.
// Sign-in is OAuth: the first time, run `/mcp login box` inside a Pi session
// and approve in the browser. No key is read or stored by this package.
export default function (pi: any) {
  if (typeof pi?.registerMcpServer !== "function") {
    console.warn("box: this Pi has no built-in MCP support (needs Pi 0.99 or later); box was not added.");
    return;
  }
  pi.registerMcpServer("box", {
    url: "https://mcp.box.simular.ai/mcp",
    description: "box by Simular: the user's cloud Linux computer with Chrome and a shell",
    exposure: "deferred",
    toolExposure: {
      shell: "direct",
      browser_navigate: "direct",
      browser_snapshot: "direct",
      screenshot: "direct",
      box_status: "direct",
    },
  });
}
