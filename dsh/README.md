# box for DeepSeek Harness (dsh)

dsh's MCP client sends fixed headers and has no sign-in, so it reaches box with a personal key.

1. Create a personal key at https://box.simular.ai/keys (under Personal keys, name it "dsh"). It is shown once.
2. Install the plugin and set the key:

   ```bash
   dsh plugin add https://github.com/simular-ai/box-plugin/releases/download/dsh-v0.1.0/dsh-box.tgz
   export BOX_TOKEN=cb_your_key
   ```

3. Restart dsh. box's tools show up as `mcp__box__*`.

To use the staging box, also set `BOX_MCP_URL=https://staging.relay.simular.cloud/mcp` (VPN required).

Contributed by Dora Qian (originally in simular-ai/box-portal#18).
