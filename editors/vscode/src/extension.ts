import path from 'node:path';
import type {ExtensionContext} from 'vscode';
import {commands, window, workspace} from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
  await startClient(context);
  context.subscriptions.push(commands.registerCommand('framescript.restartLanguageServer', async () => {
    await client?.stop();
    await startClient(context);
    void window.showInformationMessage('FrameScript language server restarted.');
  }));
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}

async function startClient(context: ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join('dist', 'server.cjs'));
  const serverOptions: ServerOptions = {
    run: {module: serverModule, transport: TransportKind.ipc},
    debug: {module: serverModule, transport: TransportKind.ipc, options: {execArgv: ['--nolazy', '--inspect=6010']}},
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{scheme: 'file', language: 'framescript'}, {scheme: 'untitled', language: 'framescript'}],
    synchronize: {
      configurationSection: 'framescript',
      fileEvents: workspace.createFileSystemWatcher('**/*.frame'),
    },
    outputChannelName: 'FrameScript Language Server',
  };
  client = new LanguageClient('framescript', 'FrameScript Language Server', serverOptions, clientOptions);
  await client.start();
}
