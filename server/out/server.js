"use strict";
/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 Telicent LTD. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ------------------------------------------------------------------------------------------ */
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const records = require('../src/records.json');
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
let workspaceFolder;
documents.onDidOpen((event) => {
    validateTextDocument(event.document);
    connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
});
documents.listen(connection);
function validateTextDocument(textDocument) {
    const diagnostics = [];
    const lines = textDocument.getText().split(/\r?\n/g);
    let inStringLiteral = false;
    let inBracketBlock = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // check if line starts or ends a string literal
        if (line.includes('"')) {
            const quoteCount = (line.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) {
                inStringLiteral = !inStringLiteral;
            }
        }
        if (inStringLiteral) {
            continue;
        }
        if (line.startsWith('#')) {
            continue;
        }
        if (/^\s*$/.test(line)) {
            continue;
        }
        // track if inside a bracket block
        if (line.includes('[')) {
            inBracketBlock = true;
        }
        if (line.includes(']')) {
            inBracketBlock = false;
        }
        if (!(line.endsWith('.') || line.endsWith(',') || line.endsWith(';'))) {
            // allow line that starts a bracket block to be exempt
            if (!(inBracketBlock && line.endsWith('['))) {
                const diagnostic = {
                    severity: node_1.DiagnosticSeverity.Error,
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: line.length }
                    },
                    message: `Lines end with a dot, comma, or semicolon`,
                    source: 'telicent-ies'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
    // Send the computed diagnostics to the LSP client.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
function createCompletionItemFromRecord(key, value) {
    return {
        label: key,
        kind: node_1.CompletionItemKind.Text,
        detail: value,
        documentation: `This item represents a ${key}.`,
        insertText: key,
    };
}
const documentsContent = new Map();
let dataToRecordMap = {};
documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
    documentsContent.set(change.document.uri, change.document.getText());
    const documentContent = change.document.getText();
    dataToRecordMap = {};
    const lines = documentContent.split(/\r?\n/g);
    for (const line of lines) {
        const match = line.match(/(data:\S+) a (\S+:\S+)/); // adjust regex to match any namespace
        if (match) {
            const dataId = match[1];
            const recordType = match[2];
            dataToRecordMap[dataId] = recordType;
        }
    }
});
connection.onHover(({ textDocument: { uri }, position }) => {
    const documentContent = documentsContent.get(uri);
    if (documentContent) {
        const lines = documentContent.split(/\r?\n/g);
        const line = lines[position.line];
        // check if the line contains an object in the form of a triple
        let match = line.match(/(?:data:\S+)\s+a\s+(?:\S+:\S+)\s*;\s*[\w:]+\s+(data:\S+)/);
        if (!match) {
            // if not, check if the line is a standalone object
            match = line.match(/(data:\S+)\s*\.\s*$/);
        }
        if (match) {
            const dataId = match[1];
            const recordType = dataToRecordMap[dataId];
            if (recordType) {
                return {
                    contents: recordType
                };
            }
        }
        // fallback to records-based lookup
        for (const record of records) {
            for (const key in record) {
                if (line.includes(key)) {
                    return {
                        contents: record[key]
                    };
                }
            }
        }
    }
    return null;
});
connection.onCompletion((params) => {
    const documentContent = documentsContent.get(params.textDocument.uri);
    if (documentContent) {
        const lines = documentContent.split(/\r?\n/g);
        const position = params.position;
        const line = lines[position.line];
        const completions = [];
        for (const record of records) {
            for (const key in record) {
                const startString = key.charAt(0).toLowerCase();
                if (line.slice(0, position.character).toLowerCase().endsWith(startString)) {
                    const completionItem = createCompletionItemFromRecord(key, record[key]);
                    completions.push(completionItem);
                }
            }
        }
        // Returns all matching completions
        return completions;
    }
    return [];
});
connection.onCompletionResolve((item) => {
    if (item.data === 1) {
        item.detail = 'This is a custom completion item for the word Helloo.';
        item.documentation = 'When you start typing "Hel", this will suggest "Helloo".';
    }
    return item;
});
connection.onInitialize((params) => {
    workspaceFolder = params.rootUri;
    connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: node_1.TextDocumentSyncKind.Full
            },
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['i', 'I']
            },
            hoverProvider: true
        }
    };
});
connection.listen();
//# sourceMappingURL=server.js.map