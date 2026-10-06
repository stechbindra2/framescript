#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
  type InitializeResult,
} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
  completions,
  codeActions,
  definition,
  diagnostics,
  documentSymbols,
  formattingEdit,
  hover,
  prepareRename,
  references,
  rename,
  semanticTokens,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from './service.js';
import {ProjectIndex} from './project-index.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
const publishedByEntry = new Map<string, Set<string>>();
let projectIndex = new ProjectIndex([process.cwd()]);

connection.onInitialize((params): InitializeResult => {
  const rootUris = params.workspaceFolders?.map(({uri}) => uri)
    ?? (params.rootUri ? [params.rootUri] : []);
  const roots = rootUris.filter((uri) => uri.startsWith('file:')).map((uri) => fileURLToPath(uri));
  projectIndex = new ProjectIndex(roots.length > 0 ? roots : [process.cwd()]);
  return {
    serverInfo: {name: 'FrameScript Language Server', version: '0.1.0'},
    capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {triggerCharacters: [':', ' ']},
    hoverProvider: true,
    definitionProvider: true,
    documentSymbolProvider: true,
    documentFormattingProvider: true,
    workspaceSymbolProvider: true,
    referencesProvider: true,
    renameProvider: {prepareProvider: true},
    codeActionProvider: true,
    semanticTokensProvider: {
      legend: {tokenTypes: [...SEMANTIC_TOKEN_TYPES], tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS]},
      full: true,
    },
    },
  };
});

documents.onDidOpen(({document}) => {
  projectIndex.setDocument(document.uri, document.getText());
  scheduleValidation(document);
});
documents.onDidChangeContent(({document}) => {
  projectIndex.setDocument(document.uri, document.getText());
  scheduleValidation(document);
});
documents.onDidClose(({document}) => {
  projectIndex.closeDocument(document.uri);
  const timer = validationTimers.get(document.uri);
  if (timer) clearTimeout(timer);
  validationTimers.delete(document.uri);
  void connection.sendDiagnostics({uri: document.uri, diagnostics: []});
});

connection.onDidChangeWatchedFiles(() => projectIndex.invalidate());

connection.onCompletion(({textDocument, position}) => {
  const document = documents.get(textDocument.uri);
  return document ? [...completions(document.getText(), document.offsetAt(position))] : [];
});

connection.onHover(({textDocument, position}) => {
  const document = documents.get(textDocument.uri);
  return document ? hover(document.getText(), document.offsetAt(position)) : null;
});

connection.onDefinition(async ({textDocument, position}) => {
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  return await projectIndex.definition(document.uri, document.offsetAt(position))
    ?? definition(document.getText(), document.uri, document.offsetAt(position));
});

connection.onDocumentSymbol(({textDocument}) => {
  const document = documents.get(textDocument.uri);
  return document ? [...documentSymbols(document.getText())] : [];
});

connection.onDocumentFormatting(({textDocument}) => {
  const document = documents.get(textDocument.uri);
  if (!document) return [];
  const edit = formattingEdit(document.getText());
  return edit ? [edit] : [];
});

connection.onReferences(async ({textDocument, position, context}) => {
  const document = documents.get(textDocument.uri);
  if (!document) return [];
  const indexed = await projectIndex.references(document.uri, document.offsetAt(position), context.includeDeclaration);
  return indexed.length > 0
    ? [...indexed]
    : [...references(document.getText(), document.uri, document.offsetAt(position), context.includeDeclaration)];
});

connection.onPrepareRename(async ({textDocument, position}) => {
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  return await projectIndex.prepareRename(document.uri, document.offsetAt(position))
    ?? prepareRename(document.getText(), document.offsetAt(position));
});

connection.onRenameRequest(async ({textDocument, position, newName}) => {
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  return await projectIndex.rename(document.uri, document.offsetAt(position), newName)
    ?? rename(document.getText(), document.uri, document.offsetAt(position), newName);
});

connection.onWorkspaceSymbol(async ({query}) => [...await projectIndex.workspaceSymbols(query)]);

connection.onCodeAction(({textDocument, context}) => {
  const document = documents.get(textDocument.uri);
  return document ? [...codeActions(document.getText(), document.uri, context.diagnostics)] : [];
});

connection.languages.semanticTokens.on(({textDocument}) => {
  const document = documents.get(textDocument.uri);
  return document ? semanticTokens(document.getText()) : {data: []};
});

function scheduleValidation(document: TextDocument): void {
  const previous = validationTimers.get(document.uri);
  if (previous) clearTimeout(previous);
  validationTimers.set(document.uri, setTimeout(() => {
    validationTimers.delete(document.uri);
    void (async () => {
      if (!document.uri.startsWith('file:')) {
        await connection.sendDiagnostics({uri: document.uri, diagnostics: [...diagnostics(document.getText())]});
        return;
      }
      const grouped = await projectIndex.diagnostics(document.uri);
      const previous = publishedByEntry.get(document.uri) ?? new Set<string>();
      const current = new Set(grouped.keys());
      current.add(document.uri);
      for (const uri of new Set([...previous, ...current])) {
        await connection.sendDiagnostics({uri, diagnostics: [...(grouped.get(uri) ?? [])]});
      }
      publishedByEntry.set(document.uri, current);
    })().catch((error: unknown) => connection.console.error(error instanceof Error ? error.stack ?? error.message : String(error)));
  }, 120));
}

documents.listen(connection);
connection.listen();
