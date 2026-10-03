// AI Sprite Studio — AI Agent Handoff card
//
// Copies the MCP server config for the chosen client (from server.mjs, or a
// template on a static host) and the active frame's generation task.

const MCP_JSON_TEMPLATE = {
  mcpServers: {
    'aisprite-studio': {
      command: 'node',
      args: ['/absolute/path/to/aisprite-studio/mcp-server/dist/index.js'],
      env: { AISPRITE_STUDIO_ROOT: '/absolute/path/to/aisprite-studio' },
    },
  },
};
const CODEX_TOML_TEMPLATE = '[mcp_servers.aisprite-studio]\ncommand = "node"\nargs = ["/absolute/path/to/aisprite-studio/mcp-server/dist/index.js"]';
const MANUAL_HANDOFF = 'Use “Copy active frame task”, give its prompt and references to the image-capable AI, then submit the resulting PNG through a local MCP-capable agent.';

/**
 * Wire the card's buttons and show whether the local MCP bridge is ready.
 * @param {{
 *   staticMode: boolean,
 *   flashLabel: (button: HTMLElement, label: string, ok?: boolean) => void,
 *   activeFrameTask: () => Promise<object | string>,
 * }} options  `activeFrameTask` returns the task, or a short reason when there is no usable frame.
 */
export async function configureAgentHandoff({ staticMode, flashLabel, activeFrameTask }) {
  const status = document.getElementById('agent-status');
  const configButton = document.getElementById('btn-copy-agent-config');
  const taskButton = document.getElementById('btn-copy-agent-task');
  const clientSelect = document.getElementById('agent-client');
  if (!status || !configButton || !taskButton) return;

  configButton.onclick = async () => {
    const selected = clientSelect?.value || 'json';
    const value = selected === 'codex'
      ? (configButton.dataset.codex || CODEX_TOML_TEMPLATE)
      : selected === 'manual'
        ? MANUAL_HANDOFF
        : (configButton.dataset.config || JSON.stringify(MCP_JSON_TEMPLATE, null, 2));
    await navigator.clipboard.writeText(value);
    flashLabel(configButton, selected === 'manual' ? '✓ handoff copied' : '✓ MCP config copied');
  };
  taskButton.onclick = async () => {
    const task = await activeFrameTask();
    if (typeof task === 'string') return flashLabel(taskButton, `✗ ${task}`, false);
    await navigator.clipboard.writeText(JSON.stringify(task, null, 2));
    flashLabel(taskButton, '✓ task copied');
  };

  if (staticMode) {
    status.textContent = 'Hosted demo is read-only. Clone aisprite-studio and connect its local MCP server to generate or submit frames.';
    configButton.textContent = 'Copy local setup template';
    return;
  }
  try {
    const response = await fetch('/api/agent-config');
    const payload = await response.json();
    configButton.dataset.config = JSON.stringify(payload.config ?? {}, null, 2);
    configButton.dataset.codex = payload.codexToml || '';
    // server.mjs answers 403 off localhost (e.g. ?mode=local on a LAN address).
    status.textContent = payload.ok ? 'Local MCP bridge is built and ready.'
      : response.ok ? `MCP needs build: ${payload.buildCommand}`
        : `MCP config unavailable: ${payload.error ?? `HTTP ${response.status}`}`;
  } catch {
    status.textContent = 'MCP config unavailable. Start the editor with npm run serve.';
  }
}
