/** @jsxImportSource @opentui/solid */
// Official OpenCode TUI extension points, not a fork or a stream/text filter.
// Never transform model responses, user prompts, tool output or permission UI.
export default {
  id: 'nullx11code.branding',
  async tui(api) {
    const renderer = api.renderer;
    const originalTitle = renderer.setTerminalTitle;
    const brandTitle = function (title) {
      const label = title === 'OpenCode' ? 'nullx11code'
        : title.startsWith('OC | ') ? `nullx11code | ${title.slice(5)}` : title;
      return originalTitle.call(renderer, label);
    };
    renderer.setTerminalTitle = brandTitle;
    const titleDisabled = ['true', '1'].includes(process.env.OPENCODE_DISABLE_TERMINAL_TITLE?.toLowerCase());
    if (!titleDisabled && api.kv.get('terminal_title_enabled', true)) renderer.setTerminalTitle('nullx11code');
    api.lifecycle.onDispose(() => {
      if (renderer.setTerminalTitle === brandTitle) renderer.setTerminalTitle = originalTitle;
    });
    api.slots.register({
      order: 1000,
      slots: {
        home_logo() {
          return <box flexDirection="column" alignItems="center" gap={1}>
            <text fg="#e99569">{'╭─ n₁₁ ────────────────────────╮'}</text>
            <text fg={api.theme.current.text}>{'│        nullx11code           │'}</text>
            <text fg="#e99569">{'╰─────────────────────────────╯'}</text>
            <text fg={api.theme.current.textMuted}>Your project. Your models. Your next idea.</text>
          </box>;
        },
        home_bottom() {
          return <box paddingTop={1} alignItems="center">
            <text fg={api.theme.current.textMuted}>nullx11code serve · browser workspace</text>
          </box>;
        },
        // Additive rather than replacing the native footer: retain directory,
        // MCP status and engine version supplied by upstream's built-in plugin.
        app_bottom() {
          return <box width="100%" flexDirection="row" paddingLeft={2} paddingRight={2}>
            <text fg="#e99569">nullx11code</text><box flexGrow={1}/>
            <text fg={api.theme.current.textMuted}>Powered by OpenCode · MIT</text>
          </box>;
        },
      },
    });
  },
};
